import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Repository } from 'typeorm';
import { Booking, BookingDraft } from '../entities';
import { MailService } from '../notifications/mail.service';
import { TicketService } from '../tickets/ticket.service';
import { AbandonedReminderService } from './abandoned-reminder.service';
import { FunnelEventDto } from './funnel.dto';
import { aggregateFunnel, rangeOf } from './funnel.service';

const errs = (body: object) => validateSync(plainToInstance(FunnelEventDto, body), { whitelist: true, forbidNonWhitelisted: true }).map((e) => e.property);

describe('funnel event validation', () => {
  it('accepts the frontend payload', () => {
    expect(errs({ step: 'view_booking', label: '', sid: 'abc123XYZ', path: '/booking' })).toEqual([]);
    expect(errs({ step: 'package_click', label: 'family', sid: 'a1' })).toEqual([]);
  });
  it('rejects unknown steps, long labels, bad sids, long paths and extra fields', () => {
    expect(errs({ step: 'hack', sid: 'a' })).toEqual(['step']);
    expect(errs({ step: 'booked', label: 'x'.repeat(61), sid: 'a' })).toEqual(['label']);
    expect(errs({ step: 'booked', sid: 'a-b' })).toEqual(['sid']);
    expect(errs({ step: 'booked', sid: 'a'.repeat(21) })).toEqual(['sid']);
    expect(errs({ step: 'booked', sid: '' })).toEqual(['sid']);
    expect(errs({ step: 'booked', sid: 'a', path: '/'.repeat(81) })).toEqual(['path']);
    expect(errs({ step: 'booked', sid: 'a', ip: '1.2.3.4' })).toEqual(['ip']);
  });
});

describe('funnel aggregation', () => {
  const at = (iso: string) => new Date(iso);
  const rows = [
    { step: 'view_booking', label: '', sid: 's1', createdAt: at('2026-10-13T10:00:00Z') },
    { step: 'view_booking', label: '', sid: 's2', createdAt: at('2026-10-13T21:00:00Z') }, // 14 Oct park time
    { step: 'view_booking', label: '', sid: 's1', createdAt: at('2026-10-13T11:00:00Z') }, // same session again
    { step: 'view_booking', label: '', sid: 's3', createdAt: at('2026-10-14T08:00:00Z') },
    { step: 'view_booking', label: '', sid: 's4', createdAt: at('2026-10-14T08:00:00Z') },
    { step: 'pick_items', label: '', sid: 's1', createdAt: at('2026-10-13T10:01:00Z') },
    { step: 'pick_items', label: '', sid: 's2', createdAt: at('2026-10-14T08:01:00Z') },
    { step: 'pick_date', label: '', sid: 's1', createdAt: at('2026-10-13T10:02:00Z') },
    { step: 'package_click', label: 'family', sid: 's1', createdAt: at('2026-10-13T10:00:30Z') },
    { step: 'package_click', label: 'family', sid: 's2', createdAt: at('2026-10-14T08:00:30Z') },
    { step: 'package_click', label: 'thrill', sid: 's3', createdAt: at('2026-10-14T08:00:30Z') },
    { step: 'addon_add', label: 'photos', sid: 's1', createdAt: at('2026-10-13T10:03:00Z') },
    { step: 'suggestion_shown', label: 'x', sid: 's1', createdAt: at('2026-10-13T10:03:00Z') },
  ];
  const r = aggregateFunnel(rows, '2026-10-13', '2026-10-14');

  it('counts events per park day', () => {
    expect(r.days.map((d) => d.date)).toEqual(['2026-10-13', '2026-10-14']);
    expect(r.days[0].counts.view_booking).toBe(2);
    expect(r.days[1].counts.view_booking).toBe(3);
    expect(r.days[1].counts.booked).toBe(0);
  });

  it('builds the conversion chain from distinct sessions', () => {
    const c = Object.fromEntries(r.chain.map((x) => [x.step, x]));
    expect(c.view_booking).toEqual({ step: 'view_booking', sessions: 4, fromPrevious: null, fromStart: null });
    expect(c.pick_items.sessions).toBe(2);
    expect(c.pick_items.fromPrevious).toBe(0.5);
    expect(c.pick_date.fromPrevious).toBe(0.5);
    expect(c.pick_date.fromStart).toBe(0.25);
    expect(c.details.sessions).toBe(0);
    expect(c.submit.fromPrevious).toBeNull(); // nothing to divide by
  });

  it('tallies packages, add-ons and suggestions by label', () => {
    expect(r.labels.package_click).toEqual([{ label: 'family', count: 2 }, { label: 'thrill', count: 1 }]);
    expect(r.labels.addon_add).toEqual([{ label: 'photos', count: 1 }]);
    expect(r.labels.suggestion_taken).toEqual([]);
    expect(r.labels.suggestion_shown).toBeUndefined();
  });

  it('turns park days into a bounded range', () => {
    const x = rangeOf('2026-10-01', '2026-10-14');
    expect(x.start.toISOString()).toBe('2026-09-30T20:00:00.000Z');
    expect(x.end.toISOString()).toBe('2026-10-14T19:59:59.999Z');
    expect(rangeOf(undefined, undefined, new Date('2026-10-14T21:00:00Z')).to).toBe('2026-10-15');
    expect(rangeOf(undefined, '2026-10-30').from).toBe('2026-10-01');
    expect(() => rangeOf('2026-10-15', '2026-10-14')).toThrow();
    expect(() => rangeOf('2026-01-01', '2026-10-14')).toThrow();
    expect(() => rangeOf('yesterday', '2026-10-14')).toThrow();
  });
});

describe('abandoned-booking reminder', () => {
  const now = new Date('2026-10-14T12:00:00Z');
  const draft = (id: string, email: string, minutesAgo: number, extra: Partial<BookingDraft> = {}): BookingDraft =>
    ({ id, email, payload: {}, remindedAt: null, createdAt: new Date(now.getTime() - minutesAgo * 60_000), expiresAt: new Date(now.getTime() + 13 * 86_400_000), ...extra }) as BookingDraft;

  function setup(drafts: BookingDraft[], bookedEmails: string[] = [], opts: { mailOn?: boolean; claimed?: string[] } = {}) {
    const claimed = new Set(opts.claimed ?? []);
    const find = jest.fn().mockResolvedValue(drafts);
    const update = jest.fn().mockImplementation((where: { id: string }) => {
      if (claimed.has(where.id)) return Promise.resolve({ affected: 0 });
      claimed.add(where.id);
      return Promise.resolve({ affected: 1 });
    });
    let email = '';
    const qb = {
      where: jest.fn().mockImplementation((_: string, p: { email: string }) => { email = p.email; return qb; }),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockImplementation(() => Promise.resolve(bookedEmails.some((e) => e.toLowerCase() === email.toLowerCase()) ? 1 : 0)),
    };
    const send = jest.fn().mockResolvedValue(true);
    const mail = { enabled: opts.mailOn ?? true, send } as unknown as MailService;
    const svc = new AbandonedReminderService(
      { find, update } as unknown as Repository<BookingDraft>,
      { createQueryBuilder: () => qb } as unknown as Repository<Booking>,
      mail,
      new ConfigService({}),
      { siteUrl: 'https://valle.test' } as TicketService,
    );
    return { svc, find, update, send, qb };
  }

  it('asks only for unreminded, unexpired drafts older than an hour', async () => {
    const { svc, find } = setup([]);
    await svc.dueDrafts(now);
    const where = find.mock.calls[0][0].where;
    expect(where.remindedAt).toBeDefined();
    expect(where.createdAt.value.toISOString()).toBe('2026-10-14T11:00:00.000Z');
    expect(where.expiresAt.value).toEqual(now);
  });

  it('sends one reminder with the resume link and claims the draft first', async () => {
    const { svc, update, send } = setup([draft('d1', 'guest@example.com', 90)]);
    expect(await svc.run(now)).toEqual({ sent: 1, skipped: 0 });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1' }), { remindedAt: now });
    expect(send).toHaveBeenCalledTimes(1);
    const m = send.mock.calls[0][0];
    expect(m.to).toBe('guest@example.com');
    expect(m.subject).toBe('Your day at VALLÉ is waiting');
    expect(m.text).toContain('https://valle.test/booking?draft=d1');
    expect(m.text).toContain('13 more days');
  });

  it('never sends twice: a draft already claimed is skipped', async () => {
    const { svc, send } = setup([draft('d1', 'a@b.co', 90)], [], { claimed: ['d1'] });
    expect(await svc.run(now)).toEqual({ sent: 0, skipped: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it('skips guests who booked with that e-mail after the draft', async () => {
    const { svc, send, update } = setup([draft('d1', 'Guest@Example.com', 90), draft('d2', 'other@example.com', 70)], ['guest@example.com']);
    expect(await svc.run(now)).toEqual({ sent: 1, skipped: 1 });
    expect(update).toHaveBeenCalledTimes(2); // both marked, so the booked one is never re-checked
    expect(send.mock.calls[0][0].to).toBe('other@example.com');
  });

  it('ignores drafts without an address and does nothing when mail is off', async () => {
    const a = setup([draft('d1', '  ', 90)]);
    expect(await a.svc.run(now)).toEqual({ sent: 0, skipped: 0 });
    const b = setup([draft('d1', 'a@b.co', 90)], [], { mailOn: false });
    expect(await b.svc.run(now)).toEqual({ sent: 0, skipped: 0 });
    expect(b.find).not.toHaveBeenCalled();
  });
});
