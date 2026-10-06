import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, LessThan, Repository } from 'typeorm';
import { Booking, BookingAudit, BookingLine, Payment } from '../entities';
import { GuestMessagingService } from '../notifications/guest-messaging.service';
import { TicketService } from '../tickets/ticket.service';
import type { PaymentProvider, WebhookEvent } from './payment-provider';
import { SandboxProvider } from './sandbox.provider';

export interface PaymentStatusView {
  id: string;
  status: Payment['status'];
  amount: number;
  refundedAmount: number;
  provider: string;
  settledAt: string | null;
  /** The booking's money after this payment, so the ticket page can show it without a second call. */
  booking: { refCode: string; total: number; paidAmount: number; balance: number };
}

/** Unpaid for this long and the ticket goes out as pay-on-arrival anyway. */
const DEFAULT_GRACE_MIN = 120;
const SWEEP_MS = 5 * 60_000;

/**
 * Online payments: a pending row per checkout, settled by the provider's
 * webhook, with the booking's paid_amount kept in step. Which gateway is behind
 * it comes from PAYMENT_PROVIDER (none by default: the site then offers pay on
 * arrival only).
 */
@Injectable()
export class PaymentsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentsService.name);
  readonly provider: PaymentProvider | null;
  private readonly graceMs: number;
  private sweep: ReturnType<typeof setInterval> | null = null;

  constructor(
    config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Payment) private readonly payRepo: Repository<Payment>,
    @InjectRepository(Booking) private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(BookingLine) private readonly lineRepo: Repository<BookingLine>,
    private readonly tickets: TicketService,
    @Optional() private readonly guest?: GuestMessagingService,
  ) {
    const name = (config.get<string>('PAYMENT_PROVIDER') ?? 'none').trim().toLowerCase();
    const apiUrl = tickets.siteUrl + '/api';
    const secret = config.get<string>('TICKET_SECRET')?.trim() || config.get<string>('JWT_SECRET')?.trim() || 'valle-dev-only-jwt-secret-change-me';
    if (name === 'sandbox') {
      if (config.get<string>('NODE_ENV') === 'production' && config.get<string>('PAYMENT_SANDBOX_IN_PRODUCTION') !== '1') {
        throw new Error('PAYMENT_PROVIDER=sandbox takes no money and must not run in production');
      }
      this.provider = new SandboxProvider(apiUrl, secret);
    } else if (name === 'none' || name === '') {
      this.provider = null;
    } else {
      // A real adapter (peach, mips) is wired here once the merchant account exists.
      throw new Error(`PAYMENT_PROVIDER=${name} is not implemented; use none or sandbox`);
    }
    const grace = Number(config.get<string>('PAYMENT_TICKET_GRACE_MIN') ?? '');
    this.graceMs = (Number.isFinite(grace) && grace > 0 ? grace : DEFAULT_GRACE_MIN) * 60_000;
    this.logger.log(`Online payments: ${this.provider ? this.provider.name : 'off (pay on arrival only)'}`);
  }

  get enabled(): boolean {
    return this.provider !== null;
  }

  onModuleInit(): void {
    if (!this.provider || process.env.NODE_ENV === 'test') return;
    this.sweep = setInterval(() => { void this.releaseAbandoned(); }, SWEEP_MS);
    this.sweep.unref?.();
  }

  onModuleDestroy(): void {
    if (this.sweep) clearInterval(this.sweep);
  }

  // ------------------------------------------------------------ checkout

  /**
   * Opens a checkout for what the booking still owes and returns the hosted
   * page to send the guest to. Called right after the booking is created
   * (payMode online) and again from the ticket page ("Pay now") if needed.
   */
  async startCheckout(booking: Booking): Promise<{ paymentId: string; checkoutUrl: string }> {
    if (!this.provider) throw new BadRequestException('Online payment is not available');
    if (booking.status === 'cancelled') throw new BadRequestException('This booking is cancelled');
    const due = booking.total - (booking.paidAmount ?? 0);
    if (due <= 0) throw new BadRequestException('This booking is already paid');

    const payment = await this.payRepo.save(this.payRepo.create({
      bookingId: booking.id, provider: this.provider.name, amount: due, currency: 'MUR', status: 'pending',
    }));
    const session = await this.provider.createCheckout({
      paymentId: payment.id,
      refCode: booking.refCode,
      amount: due,
      currency: 'MUR',
      description: `VALLÉ Advenature Park · booking ${booking.refCode}`,
      returnUrl: this.returnUrl(booking, payment.id),
      webhookUrl: `${this.tickets.siteUrl}/api/payments/webhook/${this.provider.name}`,
      guest: { name: booking.guestName, email: booking.email, phone: booking.phone },
    });
    payment.providerRef = session.providerRef;
    await this.payRepo.save(payment);
    return { paymentId: payment.id, checkoutUrl: session.redirectUrl };
  }

  /** Same, by reference and ticket token (the ticket page's "Pay now"). */
  async startCheckoutByRef(refCode: string, token: string | undefined): Promise<{ paymentId: string; checkoutUrl: string }> {
    const booking = await this.tickets.requireBooking(refCode, token);
    return this.startCheckout(booking);
  }

  async status(paymentId: string, token: string | undefined): Promise<PaymentStatusView> {
    const p = await this.payRepo.findOne({ where: { id: paymentId } });
    if (!p) throw new NotFoundException('No such payment');
    const b = await this.bookingRepo.findOne({ where: { id: p.bookingId } });
    if (!b) throw new NotFoundException('No such payment');
    if (!this.tickets.verify(b.refCode, token)) throw new ForbiddenException('Bad or missing token');
    return {
      id: p.id, status: p.status, amount: p.amount, refundedAmount: p.refundedAmount, provider: p.provider,
      settledAt: p.settledAt ? p.settledAt.toISOString() : null,
      booking: { refCode: b.refCode, total: b.total, paidAmount: b.paidAmount ?? 0, balance: Math.max(0, b.total - (b.paidAmount ?? 0)) },
    };
  }

  // ------------------------------------------------------------ webhook

  /** The provider's call: verified by the adapter, then applied once. */
  async handleWebhook(headers: Record<string, string | string[] | undefined>, body: unknown, rawBody?: Buffer): Promise<{ applied: boolean }> {
    if (!this.provider) throw new NotFoundException('Online payment is not available');
    const event = await this.provider.parseWebhook(headers, body, rawBody);
    if (!event) return { applied: false };
    return this.settle(event);
  }

  /**
   * Applies an outcome exactly once: a payment that is already settled is left
   * alone, so a provider retrying its webhook can never pay a booking twice.
   */
  async settle(event: WebhookEvent): Promise<{ applied: boolean }> {
    return this.dataSource.transaction(async (manager) => {
      const payment = event.paymentId
        ? await manager.findOne(Payment, { where: { id: event.paymentId }, lock: { mode: 'pessimistic_write' } })
        : await manager.findOne(Payment, { where: { providerRef: event.providerRef, provider: this.provider?.name }, lock: { mode: 'pessimistic_write' } });
      if (!payment) throw new NotFoundException('No such payment');
      if (payment.status !== 'pending') {
        this.logger.log(`Payment ${payment.id}: webhook ${event.status} ignored, already ${payment.status}`);
        return { applied: false };
      }
      payment.status = event.status;
      payment.raw = event.raw ?? null;
      payment.settledAt = new Date();
      if (event.providerRef) payment.providerRef = event.providerRef;
      if (event.status !== 'paid') payment.failureReason = event.reason ?? '';
      await manager.save(Payment, payment);

      if (event.status === 'paid') {
        const amount = event.amount > 0 ? event.amount : payment.amount;
        payment.amount = amount;
        await manager.save(Payment, payment);
        const booking = await manager.findOne(Booking, { where: { id: payment.bookingId }, lock: { mode: 'pessimistic_write' } });
        if (!booking) throw new NotFoundException('No such booking');
        const from = booking.paidAmount ?? 0;
        booking.paidAmount = from + amount;
        booking.paidAt = new Date();
        booking.paymentMethod = 'online';
        booking.receiptNo = payment.providerRef || payment.id;
        booking.updatedAt = new Date();
        await manager.save(Booking, booking);
        await manager.save(manager.create(BookingAudit, {
          bookingId: booking.id, staffId: null, staffEmail: `payments:${payment.provider}`, action: 'edit',
          changes: { paidAmount: { from, to: booking.paidAmount }, paymentMethod: { from: null, to: 'online' }, receiptNo: { from: null, to: booking.receiptNo } },
        }));
        // The ticket was held back until the money arrived: send it now, reading "paid".
        void this.sendTicketAfterCommit(booking.id);
      }
      this.logger.log(`Payment ${payment.id} for booking ${payment.bookingId}: ${event.status}`);
      return { applied: true };
    });
  }

  private async sendTicketAfterCommit(bookingId: string): Promise<void> {
    await new Promise((r) => setImmediate(r));
    const booking = await this.bookingRepo.findOne({ where: { id: bookingId } });
    if (!booking || !this.guest) return;
    const lines = await this.lineRepo.find({ where: { bookingId }, order: { sortOrder: 'ASC' } });
    await this.guest.sendTicket(booking, lines).catch((e: Error) => this.logger.warn(`Ticket for ${booking.refCode} not sent: ${e.message}`));
  }

  /**
   * A guest who chose to pay online but never finished keeps their places: after
   * the grace period the pending payment is cancelled and the ticket goes out as
   * pay on arrival, so they still have a QR code and the desk expects them.
   */
  async releaseAbandoned(now: Date = new Date()): Promise<number> {
    const stale = await this.payRepo.find({ where: { status: 'pending', createdAt: LessThan(new Date(now.getTime() - this.graceMs)) }, take: 50 });
    let n = 0;
    for (const p of stale) {
      const { applied } = await this.settle({ paymentId: p.id, providerRef: p.providerRef, status: 'cancelled', amount: 0, reason: 'abandoned', raw: null });
      if (!applied) continue;
      n++;
      const booking = await this.bookingRepo.findOne({ where: { id: p.bookingId } });
      if (booking && booking.status !== 'cancelled' && !booking.ticketSentAt && this.guest) {
        const lines = await this.lineRepo.find({ where: { bookingId: booking.id }, order: { sortOrder: 'ASC' } });
        await this.guest.sendTicket(booking, lines).catch((e: Error) => this.logger.warn(`Ticket for ${booking.refCode} not sent: ${e.message}`));
      }
    }
    return n;
  }

  // ------------------------------------------------------------ refunds (staff)

  /** Money back through the provider, the booking's paid_amount reduced, the trail written. */
  async refund(manager: EntityManager, booking: Booking, amount: number, reason: string, by: { id: string | null; email: string }): Promise<Payment> {
    if (!this.provider) throw new BadRequestException('Online payment is not available');
    if (!(amount > 0)) throw new BadRequestException('Enter the amount to refund');
    const payment = await manager.findOne(Payment, { where: { bookingId: booking.id, status: 'paid' }, order: { settledAt: 'DESC' }, lock: { mode: 'pessimistic_write' } });
    if (!payment) throw new BadRequestException('No online payment to refund on this booking');
    const refundable = payment.amount - payment.refundedAmount;
    if (amount > refundable) throw new BadRequestException(`Only Rs ${refundable.toLocaleString('en-US')} can still be refunded on this payment`);
    const result = await this.provider.refund(payment.providerRef, amount, reason);
    payment.refundedAmount += amount;
    if (payment.refundedAmount >= payment.amount) payment.status = 'refunded';
    payment.raw = { ...(typeof payment.raw === 'object' && payment.raw ? payment.raw : {}), lastRefund: { ...result, amount, reason, at: new Date().toISOString() } };
    await manager.save(Payment, payment);
    const from = booking.paidAmount ?? 0;
    booking.paidAmount = Math.max(0, from - amount);
    booking.updatedAt = new Date();
    await manager.save(Booking, booking);
    await manager.save(manager.create(BookingAudit, {
      bookingId: booking.id, staffId: by.id, staffEmail: by.email, action: 'edit',
      changes: { paidAmount: { from, to: booking.paidAmount }, refund: { from: null, to: `Rs ${amount.toLocaleString('en-US')} · ${reason || 'refund'} · ${result.providerRef}` } },
    }));
    return payment;
  }

  find(id: string): Promise<Payment | null> {
    return this.payRepo.findOne({ where: { id } });
  }

  bookingOf(payment: Payment): Promise<Booking | null> {
    return this.bookingRepo.findOne({ where: { id: payment.bookingId } });
  }

  /** Where the guest lands after the hosted page: their ticket, which reads the outcome. */
  returnUrl(booking: Booking, paymentId: string): string {
    return `${this.tickets.siteUrl}/ticket/${encodeURIComponent(booking.refCode)}?t=${this.tickets.token(booking.refCode)}&payment=${paymentId}`;
  }

  /** Online payments on a booking, for the staff drawer. */
  async forBooking(bookingId: string): Promise<Payment[]> {
    return this.payRepo.find({ where: { bookingId }, order: { createdAt: 'DESC' } });
  }
}
