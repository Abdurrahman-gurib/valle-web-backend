import { ConfigService } from '@nestjs/config';
import type { Booking, BookingLine } from '../entities';
import { BookingNotifierService } from './booking-notifier.service';
import { MailService } from './mail.service';

const config = (vars: Record<string, string>) =>
  ({ get: (k: string) => vars[k] }) as unknown as ConfigService;
const notifier = (vars: Record<string, string>) => new BookingNotifierService(new MailService(config(vars)), config(vars));

const booking = {
  refCode: 'VAL-1234-26', visitDate: '2026-10-02', slot: 'morning', guestName: 'Asha Ramgoolam', nationality: 'MU',
  email: 'asha@example.com', phone: '', adults: 2, kids: 1, rate: 'rr', payMode: 'gate',
  entryAmount: 1500, subtotal: 6200, discount: 0, total: 6200,
} as unknown as Booking;
const lines = [{ label: 'Zipline Adventures · Signature', amount: 4700 }] as unknown as BookingLine[];

describe('BookingNotifierService', () => {
  it('is disabled without SMTP_URL and never throws', async () => {
    const svc = notifier({});
    expect(svc.enabled).toBe(false);
    await expect(svc.notifyNewBooking(booking, lines)).resolves.toBe(false);
  });

  it('renders every fact the desk needs', () => {
    const svc = notifier({ SMTP_URL: 'json' });
    const { subject, text } = svc.render(booking, lines);
    expect(subject).toBe('New booking VAL-1234-26 · 2026-10-02 morning · Asha Ramgoolam');
    expect(text).toContain('2 adults · 1 child');
    expect(text).toContain('asha@example.com');
    expect(text).toContain('Zipline Adventures · Signature: Rs 4,700');
    expect(text).toContain('Total:       Rs 6,200');
    expect(text).toContain('pays on arrival');
    // choosing "pay online" takes no money until a gateway exists: the desk must still collect
    const online = svc.render({ ...booking, payMode: 'online', paidAmount: 0 } as unknown as Booking, lines).text;
    expect(online).toContain('nothing taken yet: collect at the gate');
    expect(svc.render({ ...booking, paidAmount: 6200 } as unknown as Booking, lines).text).toContain('Payment:     paid');
  });

  it('sends through the configured transport to BOOKING_NOTIFY_TO', async () => {
    const svc = notifier({ SMTP_URL: 'json', BOOKING_NOTIFY_TO: 'desk@example.com' });
    const sendMail = jest.fn().mockResolvedValue({});
    ((svc as unknown as { mail: MailService }).mail as unknown as { transporter: { sendMail: jest.Mock } }).transporter = { sendMail };
    await expect(svc.notifyNewBooking(booking, lines)).resolves.toBe(true);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'desk@example.com', subject: expect.stringContaining('VAL-1234-26') }));
  });

  it('logs and returns false when the mail server refuses', async () => {
    const svc = notifier({ SMTP_URL: 'json' });
    ((svc as unknown as { mail: MailService }).mail as unknown as { transporter: { sendMail: jest.Mock } }).transporter = { sendMail: jest.fn().mockRejectedValue(new Error('550')) };
    await expect(svc.notifyNewBooking(booking, lines)).resolves.toBe(false);
  });
});
