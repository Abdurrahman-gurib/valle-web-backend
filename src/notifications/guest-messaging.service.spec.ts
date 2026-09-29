import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import type { Booking, BookingLine } from '../entities';
import { TicketService } from '../tickets/ticket.service';
import { GuestMessagingService } from './guest-messaging.service';
import { MailService } from './mail.service';
import { WhatsAppService } from './whatsapp.service';

const config = (vars: Record<string, string> = {}) => ({ get: (k: string) => vars[k] }) as unknown as ConfigService;

const booking = {
  id: 'b1', refCode: 'VAL-1234-26', visitDate: '2026-10-02', slot: 'morning', guestName: 'Asha Ramgoolam', nationality: 'MU',
  email: 'asha@example.com', phone: '+230 5292 8841', adults: 2, kids: 1, rate: 'rr', payMode: 'gate',
  entryAmount: 1500, subtotal: 6200, discount: 0, total: 6200, status: 'confirmed',
} as unknown as Booking;
const lines = [{ label: 'Zipline Adventures · The Signature', amount: 4700 }] as unknown as BookingLine[];

function build(vars: Record<string, string> = { SMTP_URL: 'json' }) {
  const bookingRepo = { update: jest.fn().mockResolvedValue({}), find: jest.fn().mockResolvedValue([]) };
  const lineRepo = { find: jest.fn().mockResolvedValue(lines) };
  const tickets = new TicketService(config({ JWT_SECRET: 'x'.repeat(40), SITE_URL: 'https://example.test' }), {} as Repository<Booking>, {} as Repository<BookingLine>);
  const mail = new MailService(config(vars));
  const sendMail = jest.fn().mockResolvedValue({});
  if (vars.SMTP_URL) (mail as unknown as { transporter: { sendMail: jest.Mock } }).transporter = { sendMail };
  const wa = new WhatsAppService(config(vars));
  const posted: URLSearchParams[] = [];
  wa.post = async (_u, _a, body) => { posted.push(body); return { ok: true, status: 201, text: async () => '' }; };
  const svc = new GuestMessagingService(mail, wa, tickets, bookingRepo as unknown as Repository<Booking>, lineRepo as unknown as Repository<BookingLine>, config(vars));
  return { svc, sendMail, posted, bookingRepo, tickets };
}

describe('GuestMessagingService', () => {
  it('renders a ticket e-mail with the QR inline, the reference and the visit details', () => {
    const { svc, tickets } = build();
    const { subject, text, html } = svc.renderTicketEmail(booking, lines);
    expect(subject).toBe('Your VALLÉ ticket VAL-1234-26 · Friday, 2 October 2026');
    expect(html).toContain('cid:ticket-qr');
    expect(html).toContain('VAL-1234-26');
    expect(html).toContain('2 adults and 1 child');
    expect(html).toContain(tickets.ticketUrl('VAL-1234-26'));
    expect(text).toContain('To pay on arrival: Rs 6,200');
    expect(text).toContain('Zipline Adventures · The Signature: Rs 4,700');
    // guest input is escaped in HTML
    const { html: h2 } = svc.renderTicketEmail({ ...booking, guestName: '<b>x</b>' } as Booking, lines);
    expect(h2).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('sends the ticket by e-mail (QR attached) and WhatsApp, then stamps ticket_sent_at', async () => {
    const { svc, sendMail, posted, bookingRepo } = build({ SMTP_URL: 'json', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', TWILIO_WHATSAPP_FROM: 'whatsapp:+14155238886' });
    const r = await svc.sendTicket(booking, lines);
    expect(r).toEqual({ email: true, whatsapp: true });
    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe('asha@example.com');
    expect(mail.attachments[0]).toMatchObject({ cid: 'ticket-qr', contentType: 'image/png' });
    expect(mail.attachments[0].content.length).toBeGreaterThan(200);
    expect(posted[0].get('To')).toBe('whatsapp:+23052928841');
    expect(posted[0].get('Body')).toContain('/ticket/VAL-1234-26?t=');
    expect(bookingRepo.update).toHaveBeenCalledWith({ id: 'b1' }, { ticketSentAt: expect.any(Date) });
  });

  it('without mail or WhatsApp configured nothing is sent and nothing is stamped', async () => {
    const { svc, bookingRepo } = build({});
    await expect(svc.sendTicket(booking, lines)).resolves.toEqual({ email: false, whatsapp: false });
    expect(bookingRepo.update).not.toHaveBeenCalled();
  });

  it('reminders are due only from 17:00 park time, for tomorrow, unsent, confirmed', async () => {
    const { svc, bookingRepo } = build();
    expect(await svc.dueReminders(new Date('2026-10-01T09:00:00'))).toEqual([]);
    expect(bookingRepo.find).not.toHaveBeenCalled();
    await svc.dueReminders(new Date('2026-10-01T18:30:00'));
    expect(bookingRepo.find).toHaveBeenCalledWith({ where: expect.objectContaining({ status: 'confirmed' }) });
  });
});

describe('WhatsAppService.normalise', () => {
  it('turns local and international spellings into E.164', () => {
    expect(WhatsAppService.normalise('+230 5292 8841')).toBe('+23052928841');
    expect(WhatsAppService.normalise('5292 8841')).toBe('+23052928841');
    expect(WhatsAppService.normalise('0033 6 12 34 56 78')).toBe('+33612345678');
    expect(WhatsAppService.normalise('44 7700 900123')).toBe('+447700900123');
    expect(WhatsAppService.normalise('123')).toBeNull();
  });
});

describe('TicketService', () => {
  const tickets = new TicketService(config({ JWT_SECRET: 's'.repeat(40), SITE_URL: 'https://example.test/' }), {} as Repository<Booking>, {} as Repository<BookingLine>);
  it('tokens are stable, unguessable and verified in constant time', () => {
    const t = tickets.token('VAL-1234-26');
    expect(t).toHaveLength(24);
    expect(tickets.token('VAL-1234-26')).toBe(t);
    expect(tickets.token('VAL-1234-27')).not.toBe(t);
    expect(tickets.verify('VAL-1234-26', t)).toBe(true);
    expect(tickets.verify('VAL-1234-26', t.slice(0, 23) + 'x')).toBe(false);
    expect(tickets.verify('VAL-1234-26', undefined)).toBe(false);
  });
  it('builds the ticket and QR links on the public origin', async () => {
    expect(tickets.ticketUrl('VAL-1-26')).toMatch(/^https:\/\/example\.test\/ticket\/VAL-1-26\?t=[A-Za-z0-9_-]{24}$/);
    expect(tickets.qrUrl('VAL-1-26')).toMatch(/^https:\/\/example\.test\/api\/tickets\/VAL-1-26\/qr\.png\?t=/);
    const png = await tickets.qrPng('VAL-1-26');
    expect(png.subarray(1, 4).toString()).toBe('PNG');
  });
});
