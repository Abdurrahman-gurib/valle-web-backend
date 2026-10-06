import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Booking, BookingLine, Experience, PriceListEntry, Setting } from '../entities';
import { BookingsService, busyLevel, reserveSlotPlaces, SLOT_FULL_MESSAGE } from './bookings.service';
import { AvailabilityQueryDto } from './dto/availability-query.dto';

/** Records the clauses and returns canned grouped rows. */
class FakeQueryBuilder {
  wheres: [string, Record<string, unknown>][] = [];
  groups: string[] = [];
  constructor(private readonly rows: unknown[]) {}
  select() { return this; }
  addSelect() { return this; }
  where(sql: string, params: Record<string, unknown> = {}) { this.wheres.push([sql, params]); return this; }
  andWhere(sql: string, params: Record<string, unknown> = {}) { this.wheres.push([sql, params]); return this; }
  groupBy(f: string) { this.groups.push(f); return this; }
  addGroupBy(f: string) { this.groups.push(f); return this; }
  getRawMany() { return Promise.resolve(this.rows); }
}

function service(rows: unknown[], capacity?: string) {
  const qb = new FakeQueryBuilder(rows);
  const bookingRepo = { createQueryBuilder: () => qb } as unknown as Repository<Booking>;
  const none = {} as Repository<never>;
  const config = { get: (k: string) => (k === 'BOOKING_SLOT_CAPACITY' ? capacity : undefined) } as unknown as ConfigService;
  const svc = new BookingsService(
    {} as DataSource, bookingRepo, none as Repository<BookingLine>, none as Repository<Experience>,
    none as Repository<PriceListEntry>, none as Repository<Setting>, undefined, undefined, undefined, undefined, config,
  );
  return { svc, qb };
}

describe('busyLevel', () => {
  it('maps the share of the slot capacity to four levels', () => {
    expect(busyLevel(0, 150)).toBe('quiet');
    expect(busyLevel(52, 150)).toBe('quiet');
    expect(busyLevel(53, 150)).toBe('busy');
    expect(busyLevel(104, 150)).toBe('busy');
    expect(busyLevel(105, 150)).toBe('very-busy');
    expect(busyLevel(150, 150)).toBe('full');
  });
});

describe('BookingsService.availability', () => {
  it('returns one entry per day with both slots, filled from the grouped rows', async () => {
    const { svc, qb } = service([
      { date: '2026-10-02', slot: 'morning', bookings: '3', guests: '60' },
      { date: new Date('2026-10-03T00:00:00Z'), slot: 'afternoon', bookings: '9', guests: '160' },
      { date: '2026-10-03', slot: 'evening', bookings: '1', guests: '2' }, // unknown slot: ignored
    ]);
    const days = await svc.availability('2026-10-02', 3);
    expect(days.map((d) => d.date)).toEqual(['2026-10-02', '2026-10-03', '2026-10-04']);
    expect(days[0].morning).toEqual({ bookings: 3, guests: 60, level: 'busy' });
    expect(days[0].afternoon).toEqual({ bookings: 0, guests: 0, level: 'quiet' });
    expect(days[1].afternoon).toEqual({ bookings: 9, guests: 160, level: 'full' });
    expect(days[2].morning.level).toBe('quiet');
    // cancelled and postponed bookings never count, and the range is bound as parameters
    expect(qb.wheres).toEqual([
      ['b.visitDate BETWEEN :from AND :to', { from: '2026-10-02', to: '2026-10-04' }],
      ['b.status NOT IN (:...gone)', { gone: ['cancelled', 'postponed'] }],
    ]);
    expect(qb.groups).toEqual(['b.visitDate', 'b.slot']);
  });

  it('honours BOOKING_SLOT_CAPACITY and caps the window at 62 days', async () => {
    const { svc } = service([{ date: '2026-10-02', slot: 'morning', bookings: '1', guests: '30' }], '40');
    const days = await svc.availability('2026-10-02', 500);
    expect(days).toHaveLength(62);
    expect(days[0].morning.level).toBe('very-busy');
  });
});

describe('AvailabilityQueryDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const run = (q: Record<string, unknown>) => pipe.transform(q, { type: 'query', metatype: AvailabilityQueryDto });

  it('accepts a date and a day count, coercing the number', async () => {
    await expect(run({ from: '2026-10-02', days: '21' })).resolves.toEqual({ from: '2026-10-02', days: 21 });
  });

  it('rejects malformed dates and out-of-range windows', async () => {
    await expect(run({ from: '02/10/2026' })).rejects.toThrow();
    await expect(run({ days: '0' })).rejects.toThrow();
    await expect(run({ days: '90' })).rejects.toThrow();
  });
});

describe('reserveSlotPlaces', () => {
  /** A manager that records the advisory lock and answers the guest count. */
  function fakeManager(guests: number) {
    const calls: { lock?: unknown[]; wheres: [string, Record<string, unknown>][] } = { wheres: [] };
    const qb = {
      select() { return this; },
      where(sql: string, p: Record<string, unknown> = {}) { calls.wheres.push([sql, p]); return this; },
      andWhere(sql: string, p: Record<string, unknown> = {}) { calls.wheres.push([sql, p]); return this; },
      getRawOne: () => Promise.resolve({ guests: String(guests) }),
    };
    const manager = {
      query: (sql: string, params: unknown[]) => { calls.lock = [sql, ...params]; return Promise.resolve([]); },
      createQueryBuilder: () => qb,
    } as unknown as EntityManager;
    return { manager, calls };
  }

  it('takes a transaction lock on the slot, counts its live guests and lets a party in while there is room', async () => {
    const { manager, calls } = fakeManager(140);
    await expect(reserveSlotPlaces(manager, '2026-11-20', 'morning', 10, 150)).resolves.toBe(140);
    expect(calls.lock).toEqual(['SELECT pg_advisory_xact_lock(hashtext($1))', 'slot:2026-11-20:morning']);
    expect(calls.wheres).toContainEqual(['b.status NOT IN (:...gone)', { gone: ['cancelled', 'postponed'] }]);
    expect(calls.wheres).toContainEqual(['b.slot = :slot', { slot: 'morning' }]);
  });

  it('refuses the party that would take the slot over capacity, with a 409', async () => {
    const { manager } = fakeManager(140);
    await expect(reserveSlotPlaces(manager, '2026-11-20', 'morning', 11, 150)).rejects.toMatchObject({ status: 409, message: SLOT_FULL_MESSAGE });
  });

  it('leaves out the booking being edited so moving it within the slot does not count twice', async () => {
    const { manager, calls } = fakeManager(0);
    await reserveSlotPlaces(manager, '2026-11-20', 'afternoon', 4, 150, 'b-1');
    expect(calls.wheres).toContainEqual(['b.id != :exceptId', { exceptId: 'b-1' }]);
  });
});
