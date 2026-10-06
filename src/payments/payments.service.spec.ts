import { ConfigService } from '@nestjs/config';
import type { DataSource, EntityManager, Repository } from 'typeorm';
import { Booking, BookingAudit, BookingLine, Payment } from '../entities';
import type { GuestMessagingService } from '../notifications/guest-messaging.service';
import type { TicketService } from '../tickets/ticket.service';
import { PaymentsService } from './payments.service';
import { SandboxProvider } from './sandbox.provider';

const config = (vars: Record<string, string>) => ({ get: (k: string) => vars[k] }) as unknown as ConfigService;
const tickets = { siteUrl: 'https://example.test', token: (ref: string) => 'tok_' + ref, verify: (_r: string, t?: string) => t === 'tok_VAL-1-26', requireBooking: jest.fn() } as unknown as TicketService;

/** One booking, its payments and the audit rows, behind a fake transaction manager. */
function world(opts: { booking?: Partial<Booking>; payments?: Partial<Payment>[]; provider?: string } = {}) {
  const booking = Object.assign(new Booking(), { id: 'b1', refCode: 'VAL-1-26', guestName: 'Asha', email: 'a@example.com', phone: '', total: 6200, paidAmount: 0, status: 'confirmed', ticketSentAt: null }, opts.booking);
  const payments: Payment[] = (opts.payments ?? []).map((p, i) => Object.assign(new Payment(), { id: 'p' + (i + 1), bookingId: 'b1', provider: 'sandbox', providerRef: '', amount: 6200, currency: 'MUR', status: 'pending', refundedAmount: 0, failureReason: '', raw: null, createdAt: new Date(), settledAt: null }, p));
  const audit: BookingAudit[] = [];
  const manager = {
    findOne: (ctor: unknown, o: { where: Record<string, unknown> }) => {
      if (ctor === Payment) return Promise.resolve(payments.find((p) => (o.where.id ? p.id === o.where.id : true) && (o.where.status ? p.status === o.where.status : true) && (o.where.providerRef ? p.providerRef === o.where.providerRef : true)) ?? null);
      if (ctor === Booking) return Promise.resolve(booking);
      return Promise.resolve(null);
    },
    // save(Entity, row) and save(rowFromCreate) are both used by the service
    save: (a: unknown, b?: unknown) => { const e = (b ?? a) as BookingAudit & { __audit?: boolean }; if (a === BookingAudit || e.__audit) audit.push(e); return Promise.resolve(e); },
    create: (ctor: unknown, v: object) => ({ ...v, __audit: ctor === BookingAudit }),
  } as unknown as EntityManager;
  const dataSource = { transaction: (run: (m: EntityManager) => Promise<unknown>) => run(manager) } as unknown as DataSource;
  const payRepo = {
    create: (v: Partial<Payment>) => Object.assign(new Payment(), { id: 'p' + (payments.length + 1), refundedAmount: 0, createdAt: new Date() }, v),
    save: (p: Payment) => { if (!payments.includes(p)) payments.push(p); return Promise.resolve(p); },
    findOne: (o: { where: { id: string } }) => Promise.resolve(payments.find((p) => p.id === o.where.id) ?? null),
    find: () => Promise.resolve(payments.filter((p) => p.status === 'pending')),
  } as unknown as Repository<Payment>;
  const bookingRepo = { findOne: () => Promise.resolve(booking) } as unknown as Repository<Booking>;
  const lineRepo = { find: () => Promise.resolve([]) } as unknown as Repository<BookingLine>;
  const guest = { sendTicket: jest.fn().mockResolvedValue({ email: true, whatsapp: false }) } as unknown as GuestMessagingService;
  const svc = new PaymentsService(config({ PAYMENT_PROVIDER: opts.provider ?? 'sandbox', TICKET_SECRET: 's'.repeat(40), PAYMENT_TICKET_GRACE_MIN: '1' }), dataSource, payRepo, bookingRepo, lineRepo, tickets, guest);
  return { svc, booking, payments, audit, guest, manager };
}

describe('PaymentsService', () => {
  it('is off without PAYMENT_PROVIDER and refuses the sandbox in production', () => {
    expect(world({ provider: 'none' }).svc.enabled).toBe(false);
    expect(() => new PaymentsService(config({ PAYMENT_PROVIDER: 'sandbox', NODE_ENV: 'production' }), {} as DataSource, {} as Repository<Payment>, {} as Repository<Booking>, {} as Repository<BookingLine>, tickets)).toThrow(/production/);
    expect(() => new PaymentsService(config({ PAYMENT_PROVIDER: 'peach' }), {} as DataSource, {} as Repository<Payment>, {} as Repository<Booking>, {} as Repository<BookingLine>, tickets)).toThrow(/not implemented/);
  });

  it('opens a checkout for the balance due, with the ticket page as the return address', async () => {
    const { svc, booking, payments } = world({ booking: { paidAmount: 1200 } });
    const { paymentId, checkoutUrl } = await svc.startCheckout(booking);
    expect(payments[0].amount).toBe(5000);
    expect(payments[0].status).toBe('pending');
    expect(checkoutUrl).toMatch(/^https:\/\/example\.test\/api\/payments\/sandbox\/p1\?k=/);
    expect(svc.returnUrl(booking, paymentId)).toBe('https://example.test/ticket/VAL-1-26?t=tok_VAL-1-26&payment=p1');
    await expect(svc.startCheckout(Object.assign(new Booking(), booking, { paidAmount: 6200 }))).rejects.toMatchObject({ status: 400 });
  });

  it('a paid webhook settles the payment once: the booking is paid, the trail written, the ticket sent, a retry ignored', async () => {
    const { svc, booking, payments, audit, guest } = world({ payments: [{ providerRef: 'sbx_1' }] });
    const sbx = svc.provider as SandboxProvider;
    const body = { paymentId: 'p1', providerRef: 'sbx_1', status: 'paid', amount: 6200, sig: sbx.sign('p1', 'paid', 6200) };
    await expect(svc.handleWebhook({}, body)).resolves.toEqual({ applied: true });
    expect(payments[0].status).toBe('paid');
    expect(booking.paidAmount).toBe(6200);
    expect(booking.paymentMethod).toBe('online');
    expect(audit).toHaveLength(1);
    expect(audit[0].changes).toMatchObject({ paidAmount: { from: 0, to: 6200 } });
    await new Promise((r) => setTimeout(r, 5));
    expect(guest.sendTicket).toHaveBeenCalledTimes(1);
    // the provider retries: nothing changes
    await expect(svc.handleWebhook({}, body)).resolves.toEqual({ applied: false });
    expect(booking.paidAmount).toBe(6200);
    expect(audit).toHaveLength(1);
  });

  it('a webhook with a bad signature is refused and a failed outcome never touches the booking', async () => {
    const { svc, booking, payments } = world({ payments: [{}] });
    await expect(svc.handleWebhook({}, { paymentId: 'p1', status: 'paid', amount: 6200, sig: 'nope' })).rejects.toMatchObject({ status: 403 });
    const sbx = svc.provider as SandboxProvider;
    await svc.handleWebhook({}, { paymentId: 'p1', status: 'failed', amount: 0, reason: 'declined', sig: sbx.sign('p1', 'failed', 0) });
    expect(payments[0].status).toBe('failed');
    expect(payments[0].failureReason).toBe('declined');
    expect(booking.paidAmount).toBe(0);
  });

  it('an abandoned checkout is cancelled after the grace period and the ticket goes out as pay on arrival', async () => {
    const old = new Date(Date.now() - 10 * 60_000);
    const { svc, payments, guest } = world({ payments: [{ createdAt: old }] });
    await expect(svc.releaseAbandoned()).resolves.toBe(1);
    expect(payments[0].status).toBe('cancelled');
    expect(guest.sendTicket).toHaveBeenCalledTimes(1);
  });

  it('refunds through the provider, never more than was paid, and lowers the booking paid amount', async () => {
    const { svc, booking, payments, audit, manager } = world({ booking: { paidAmount: 6200, paymentMethod: 'online' }, payments: [{ status: 'paid', providerRef: 'sbx_1', settledAt: new Date() }] });
    await svc.refund(manager, booking, 2000, 'rain day', { id: 'u1', email: 'desk@example.com' });
    expect(payments[0].refundedAmount).toBe(2000);
    expect(payments[0].status).toBe('paid');
    expect(booking.paidAmount).toBe(4200);
    expect(audit[0].changes).toMatchObject({ paidAmount: { from: 6200, to: 4200 } });
    await expect(svc.refund(manager, booking, 5000, '', { id: 'u1', email: 'desk@example.com' })).rejects.toMatchObject({ status: 400 });
    await svc.refund(manager, booking, 4200, 'rest', { id: 'u1', email: 'desk@example.com' });
    expect(payments[0].status).toBe('refunded');
    expect(booking.paidAmount).toBe(0);
  });
});
