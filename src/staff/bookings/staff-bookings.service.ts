import {
  BadRequestException,
  ConflictException,
  Optional,
  Injectable,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  IsNull,
  Not,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { adjustmentAmount, computeBooking, entrySettings, type AdjustmentKind, type PricedBooking } from '../../bookings/pricing';
import { lineRecords } from '../../bookings/booking-records';
import { CouponsService } from '../../coupons/coupons.service';
import { renderReceiptPdf } from '../../tickets/receipt-pdf';
import {
  Booking,
  BookingAudit,
  BookingAuditAction,
  BookingAuditChanges,
  BookingLine,
  ChatConversation,
  Experience,
  Quote,
  Setting, PriceListEntry,
  Product,
} from '../../entities';
import type { StaffPrincipal } from '../auth/staff-auth.types';
import { BookingSort, ListBookingsQueryDto, PageQueryDto } from './dto/list-bookings.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { CreateStaffBookingDto } from './dto/create-staff-booking.dto';
import { BookingsService } from '../../bookings/bookings.service';
import { reservePlaces } from '../../bookings/capacity';
import { PaymentsService } from '../../payments/payments.service';
import { InboxNotifierService } from '../../notifications/inbox-notifier.service';
import type { TicketView } from '../../tickets/ticket.service';
import type { GuestChangeDto } from './guest-changes.controller';
import { TicketService } from '../../tickets/ticket.service';
import { GuestMessagingService } from '../../notifications/guest-messaging.service';
import { auditRecord, type Actor } from '../../common/audit';
import { settingsMap } from '../../common/collections';
import { noBooking } from '../../common/lookup';
import { pageOffset, resolvePaging, type Paged } from '../../common/paging';
import { isoDay, PARK_TZ, parkToday, startOfMonth, startOfNextMonth } from '../../common/park-time';
import { toBookingRow, type BookingRow } from './booking-row';
import {
  applyPatch, auditAction, auditedChanges, fitLinesToParty, lineCountChanges, linesAsItems, normalizePatch, patchFields, patchItems,
  placesItems, repricingItems, touchesMoney, touchesPlaces,
  type BookingPatch, type Party,
} from './booking-patch';
import { WaiversService } from '../../waivers/waivers.service';
import { mergePaymentMethod } from './payment-method';
import { AUDIT_LIMIT, toBookingDetail, toQuoteRow, type BookingDetail, type QuoteRow, type StaffStats } from './staff-booking-views';

export { toBookingRow, type BookingRow } from './booking-row';
export type { Paged } from '../../common/paging';
export type { BookingAuditRow, BookingDetail, BookingLineRow, QuoteRow, StaffStats } from './staff-booking-views';

/**
 * Who the trail shows for a change made from the ticket page: no staff
 * account, the label "guest".
 */
const GUEST: Actor = { id: null, email: 'guest' };

/** Column and direction behind each `sort` of the bookings list. */
const SORT_ORDER: Record<BookingSort, [string, 'ASC' | 'DESC']> = {
  newest: ['b.createdAt', 'DESC'], oldest: ['b.createdAt', 'ASC'], visit_asc: ['b.visitDate', 'ASC'],
  visit_desc: ['b.visitDate', 'DESC'], total_desc: ['b.total', 'DESC'], total_asc: ['b.total', 'ASC'], guest: ['b.guestName', 'ASC'],
};

const LINE_ORDER = { sortOrder: 'ASC' } as const;
const AUDIT_ORDER = { createdAt: 'DESC', id: 'DESC' } as const;

@Injectable()
export class StaffBookingsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(BookingLine)
    private readonly lineRepo: Repository<BookingLine>,
    @InjectRepository(BookingAudit)
    private readonly auditRepo: Repository<BookingAudit>,
    @InjectRepository(Quote)
    private readonly quoteRepo: Repository<Quote>,
    @InjectRepository(ChatConversation)
    private readonly chatRepo: Repository<ChatConversation>,
    private readonly bookings: BookingsService,
    private readonly tickets: TicketService,
    private readonly guest: GuestMessagingService,
    private readonly coupons: CouponsService,
    @Optional() private readonly payments?: PaymentsService,
    @Optional() private readonly inbox?: InboxNotifierService,
    @Optional() private readonly waivers?: WaiversService,
  ) {}

  // ----------------------------------------------------------------- bookings

  async list(query: ListBookingsQueryDto): Promise<Paged<BookingRow>> {
    const paging = resolvePaging(query);
    const qb = filterBookings(this.bookingRepo.createQueryBuilder('b'), query);
    const [col, dir] = SORT_ORDER[query.sort ?? 'newest'] ?? SORT_ORDER.newest;
    const [rows, total] = await qb
      .orderBy(col, dir)
      .addOrderBy('b.createdAt', 'DESC')
      .skip(pageOffset(paging))
      .take(paging.pageSize)
      .getManyAndCount();

    return { items: rows.map(toBookingRow), total, ...paging };
  }

  /**
   * A booking taken by an operator (phone, front desk, e-mail, WhatsApp). Priced
   * and validated exactly like a website booking, then stamped with who took it
   * and through which channel, so the trail starts with a 'create' entry.
   */
  async createForGuest(dto: CreateStaffBookingDto, staff: StaffPrincipal): Promise<BookingDetail> {
    const { channel, note, payment, ...bookingDto } = dto;
    const created = await this.bookings.create(bookingDto);
    const booking = await this.findOr404(created.refCode);
    const stamp = `Taken by ${staff.name} (${CHANNEL_LABEL[channel] ?? channel})`;
    booking.staffNote = [stamp, (note ?? '').trim()].filter(Boolean).join('\n');
    // "Paid online / by transfer" in the drawer means the money has arrived: record it,
    // otherwise the guest's ticket would still ask them to pay at the gate. It is a
    // transfer to the park's account, not a provider payment the drawer could refund.
    const prepaid = bookingDto.payMode === 'online' && !payment && booking.total > 0;
    if (prepaid) {
      booking.paidAmount = booking.total;
      booking.paidAt = new Date();
      booking.paymentMethod = 'transfer';
    }
    touch(booking, staff);
    await this.bookingRepo.save(booking);
    await this.auditRepo.save(
      this.auditRepo.create(auditRecord(booking.id, staff, 'create', { channel: { from: null, to: channel } })),
    );
    if (prepaid) {
      // one ledger entry per payment, so the day's reconciliation counts it under its method
      await this.auditRepo.save(this.auditRepo.create(auditRecord(booking.id, staff, 'edit', {
        paidAmount: { from: 0, to: booking.total }, paymentMethod: { from: null, to: 'transfer' },
      })));
    }
    // A walk-in paying at the desk: the cashier's payment, in the same step.
    // No amount means "paid in full": the total the server priced, coupon included.
    if (payment && booking.total > 0) {
      return this.recordPayment(booking.refCode, { ...payment, amount: payment.amount ?? booking.total }, staff);
    }
    return this.detail(booking.refCode);
  }

  async detail(refCode: string): Promise<BookingDetail> {
    const booking = await this.findOr404(refCode);
    const [lines, audit] = await Promise.all([
      this.lineRepo.find({ where: { bookingId: booking.id }, order: LINE_ORDER }),
      this.auditRepo.find({ where: { bookingId: booking.id }, order: AUDIT_ORDER, take: AUDIT_LIMIT }),
    ]);
    return this.withTicket(toBookingDetail(booking, lines, audit));
  }

  /** Re-send the guest's ticket (e-mail + WhatsApp) after a change of contact details, or on request. */
  async resendTicket(refCode: string): Promise<{ email: boolean; whatsapp: boolean }> {
    return this.guest.sendTicket(await this.findOr404(refCode));
  }

  /** The cashier took money: adds to what was paid, keeps the receipt number, writes the trail. */
  async recordPayment(refCode: string, input: { amount: number; method: string; receiptNo?: string }, staff: StaffPrincipal): Promise<BookingDetail> {
    return this.dataSource.transaction(async (manager) => {
      const booking = await lockOr404(manager, refCode);
      if (booking.status === 'cancelled') throw new BadRequestException('This booking is cancelled');
      const from = booking.paidAmount;
      const receiptNo = input.receiptNo?.trim();
      booking.paidAmount = from + input.amount;
      booking.paidAt = new Date();
      // cash then card reads "cash+card": the booking does not forget the first payment
      booking.paymentMethod = mergePaymentMethod(from > 0 ? booking.paymentMethod : '', input.method);
      if (receiptNo) booking.receiptNo = receiptNo;
      touch(booking, staff);
      await manager.save(Booking, booking);
      await this.writeAudit(manager, booking, staff, 'edit', {
        paidAmount: { from, to: booking.paidAmount },
        paymentMethod: { from: null, to: input.method },
        ...(receiptNo ? { receiptNo: { from: null, to: receiptNo } } : {}),
      });
      return this.readDetail(manager, booking);
    });
  }

  /** Money back through the payment provider; the booking's paid amount follows and the trail says why. */
  async refund(refCode: string, input: { amount: number; reason?: string }, staff: StaffPrincipal): Promise<BookingDetail> {
    const payments = this.payments;
    if (!payments) throw new BadRequestException('Online payment is not available');
    return this.dataSource.transaction(async (manager) => {
      const booking = await lockOr404(manager, refCode);
      await payments.refund(manager, booking, input.amount, (input.reason ?? '').trim(), { id: staff.id, email: staff.email });
      // refund() already stamped updated_at with the moment the money moved
      booking.updatedBy = staff.id;
      await manager.save(Booking, booking);
      return this.readDetail(manager, booking);
    });
  }

  // ------------------------------------------------------------ guest self-service

  /** What a guest may still touch: a confirmed or postponed booking whose day has not passed. */
  private guestCanChange(b: Booking): void {
    if (b.status === 'cancelled') throw new BadRequestException('This booking is cancelled');
    if (b.status === 'arrived') throw new BadRequestException('You have already checked in; ask the desk for any change');
    if (b.status === 'confirmed' && isoDay(b.visitDate) < parkToday()) throw new BadRequestException('This visit date has passed; call us to rebook');
  }

  /**
   * A guest changes their own booking from the ticket link: date, slot, party or
   * experiences. Same re-pricing, capacity check and audit as a desk edit; a
   * postponed (weather) booking picking a new date comes back to confirmed.
   */
  async guestChange(refCode: string, token: string | undefined, dto: GuestChangeDto): Promise<TicketView> {
    const booking = await this.tickets.requireBooking(refCode, token);
    this.guestCanChange(booking);
    const patch = guestPatch(booking, dto);
    await this.checkGuestParty(booking, dto);
    const detail = await this.update(refCode, patch, GUEST);
    void this.afterGuestChange(refCode, describeGuestChange(dto, detail) || 'changed');
    return this.tickets.view(refCode, token);
  }

  /** The guest's new lines (or the lines kept) must fit the new party, with no child below a 12+ minimum. */
  private async checkGuestParty(booking: Booking, dto: GuestChangeDto): Promise<void> {
    const items = dto.items ?? (await this.lineRepo.find({ where: { bookingId: booking.id } }))
      .filter((l) => l.experienceId || l.productKey)
      .map((l) => ({ id: l.experienceId ?? 'product:' + (l.productKey ?? ''), adults: l.adults, kids: l.kids }));
    await this.bookings.checkParty(items, { adults: dto.adults ?? booking.adults, kids: dto.kids ?? booking.kids, infants: dto.infants ?? booking.infants ?? 0 });
  }

  async guestCancel(refCode: string, token: string | undefined, reason: string): Promise<TicketView> {
    const booking = await this.tickets.requireBooking(refCode, token);
    this.guestCanChange(booking);
    const note = `Cancelled by the guest from the ticket page${reason ? `: ${reason}` : ''}`;
    await this.update(refCode, { status: 'cancelled', staffNote: [booking.staffNote, note].filter(Boolean).join('\n') }, GUEST);
    void this.afterGuestChange(refCode, note);
    return this.tickets.view(refCode, token);
  }

  /** The guest gets a fresh ticket, the desk an e-mail. Never throws. */
  private async afterGuestChange(refCode: string, what: string): Promise<void> {
    const booking = await this.bookingRepo.findOne({ where: { refCode } });
    if (!booking) return;
    await this.inbox?.notifyGuestChange(booking, what).catch(() => false);
    if (booking.status !== 'cancelled') {
      const lines = await this.lineRepo.find({ where: { bookingId: booking.id }, order: LINE_ORDER });
      await this.guest.sendTicket(booking, lines).catch(() => ({ email: false, whatsapp: false }));
    }
  }

  /** Weather day: the visit is postponed, money stays on the booking, the guest picks a new date later. */
  async postpone(refCode: string, reason: string, staff: StaffPrincipal): Promise<BookingDetail> {
    const why = (reason ?? '').trim();
    if (why.length < 3) throw new BadRequestException('Give a reason for the postponement (at least 3 characters)');
    return this.dataSource.transaction(async (manager) => {
      const booking = await lockOr404(manager, refCode);
      if (booking.status === 'cancelled') throw new BadRequestException('This booking is cancelled');
      const from = booking.status;
      booking.postponedFrom = isoDay(booking.visitDate);
      booking.status = 'postponed';
      touch(booking, staff);
      await manager.save(Booking, booking);
      await this.writeAudit(manager, booking, staff, 'status', {
        status: { from, to: 'postponed' },
        reason: { from: null, to: why },
      });
      return this.readDetail(manager, booking);
    });
  }

  async receiptPdf(refCode: string): Promise<Buffer> {
    const booking = await this.findOr404(refCode);
    const lines = await this.lineRepo.find({ where: { bookingId: booking.id }, order: LINE_ORDER });
    return renderReceiptPdf(booking, lines, { siteUrl: this.tickets.siteUrl });
  }

  async resendWaiverLink(refCode: string): Promise<{ email: boolean; whatsapp: boolean }> {
    return this.guest.sendWaiverLink(await this.findOr404(refCode));
  }

  private withTicket(detail: BookingDetail): BookingDetail {
    return { ...detail, ticketUrl: this.tickets.ticketUrl(detail.refCode, detail.lang) };
  }

  private async findOr404(refCode: string): Promise<Booking> {
    const booking = await this.bookingRepo.findOne({ where: { refCode } });
    if (!booking) throw noBooking(refCode);
    return booking;
  }

  /**
   * Apply a staff edit. Money is never taken from the request: when the party
   * or the rate moves, the booking's own experience lines are re-priced with
   * `computeBooking`, exactly as the public booking flow prices a new order.
   * The row, its lines and one audit entry are written in a single transaction.
   */
  async update(
    refCode: string,
    dto: UpdateBookingDto,
    staff: Actor,
  ): Promise<BookingDetail> {
    const patch = normalizePatch(dto);
    if (patchFields(patch).length === 0) {
      throw new BadRequestException(
        'Provide at least one field to update',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const booking = await lockOr404(manager, refCode);
      assertNotStale(booking, dto.expectedUpdatedAt);

      // A booking has to stay reachable, exactly as BookingsService.create insists.
      const nextEmail = patch.email ?? booking.email;
      const nextPhone = patch.phone ?? booking.phone;
      if (!nextEmail && !nextPhone) {
        throw new BadRequestException(
          'Keep at least an email address or a phone number on the booking',
        );
      }

      const linesNote = await this.fitLines(manager, booking, patch);
      const changes = auditedChanges(booking, patch);
      const changed = Object.keys(changes);
      if (changed.length === 0) {
        // Nothing moved: leave updated_at and the trail alone.
        return this.readDetail(manager, booking);
      }
      // the trail reads "zipline 2+2 → 3+1", not the JSON of every line
      if (changes.items && linesNote) changes.items = { from: null, to: linesNote };

      if (patch.status === 'arrived' && changes.status) Object.assign(changes, await this.arrivalRule(booking.refCode, dto));
      else if (dto.reason?.trim() && changes.status) changes.reason = { from: null, to: dto.reason.trim() };

      if (touchesMoney(changes)) await this.reprice(manager, booking, patch);
      await this.ensureRoom(manager, booking, patch, changes);

      applyPatch(booking, patch);
      touch(booking, staff);
      await manager.save(Booking, booking);
      await this.writeAudit(manager, booking, staff, auditAction(changed), changes);

      return this.readDetail(manager, booking);
    });
  }

  /**
   * A new party never leaves the lines charging for guests who are not coming:
   * requested lines are clamped to the party, and when the party moves without
   * new lines the booking's own lines are fitted to it (fitLinesToParty). The
   * patch then carries the fitted lines, so re-pricing, the capacity check and
   * the trail all see the same thing. Returns the readable change, if any.
   */
  private async fitLines(manager: EntityManager, booking: Booking, patch: BookingPatch): Promise<string> {
    const from: Party = { adults: booking.adults, kids: booking.kids };
    const to: Party = { adults: patch.adults ?? booking.adults, kids: patch.kids ?? booking.kids };
    const requested = patchItems(patch);
    if (requested) {
      const clamped = fitLinesToParty(requested, { adults: 0, kids: 0 }, to);
      patch.items = JSON.stringify(clamped);
      return lineCountChanges(requested, clamped);
    }
    if (from.adults === to.adults && from.kids === to.kids) return '';
    const existing = linesAsItems(await manager.find(BookingLine, {
      where: [{ bookingId: booking.id, experienceId: Not(IsNull()) }, { bookingId: booking.id, productKey: Not(IsNull()) }],
      order: LINE_ORDER,
    }));
    const fitted = fitLinesToParty(existing, from, to);
    const note = lineCountChanges(existing, fitted);
    if (note) patch.items = JSON.stringify(fitted);
    return note;
  }

  /**
   * "Mark arrived" from the drawer or the day sheet follows the gate's rule:
   * with waivers missing or flagged it needs an explicit override and a reason,
   * and the trail records both. Returns the extra audit entries.
   */
  private async arrivalRule(refCode: string, dto: UpdateBookingDto): Promise<BookingAuditChanges> {
    const check = this.waivers ? await this.waivers.arrivalCheck(refCode) : null;
    if (!check) return {};
    const signed = { waivers: { from: null, to: `${check.signedCount}/${check.required} signed` } };
    if (!check.blocked) return signed;
    if (!dto.override) {
      throw new ConflictException({
        statusCode: 409, error: 'Conflict', code: 'WAIVERS_MISSING', message: check.message,
        missing: check.missing, required: check.required, signed: check.signedCount, stops: check.stops,
      });
    }
    const reason = (dto.reason ?? '').trim();
    if (reason.length < 3) throw new BadRequestException('Give the reason for checking in without all the waivers');
    return { ...signed, gateOverride: { from: null, to: reason } };
  }

  /**
   * Moving a booking into a slot, or growing the party, needs room there too,
   * the same rule the website applies; the booking's own guests do not count.
   */
  private async ensureRoom(manager: EntityManager, booking: Booking, patch: BookingPatch, changes: BookingAuditChanges): Promise<void> {
    const nextStatus = patch.status ?? booking.status;
    if (!touchesPlaces(changes) || nextStatus === 'cancelled' || nextStatus === 'postponed') return;
    const [cal, experiences] = await Promise.all([this.bookings.calendar(), this.bookings.experienceInfo()]);
    const lines = await manager.find(BookingLine, { where: { bookingId: booking.id } });
    await reservePlaces(
      manager,
      {
        visitDate: patch.visitDate ?? isoDay(booking.visitDate),
        slot: patch.slot ?? booking.slot,
        adults: patch.adults ?? booking.adults,
        kids: patch.kids ?? booking.kids,
        infants: patch.infants ?? booking.infants ?? 0,
        items: placesItems(patch, lines),
        exceptBookingId: booking.id,
      },
      cal,
      experiences,
    );
  }

  /**
   * Rebuild the money from the booking's stored experience lines with the new
   * party and rate, then rewrite `booking_lines`. The park-entry line is not
   * read back: `computeBooking` regenerates it from the new party.
   */
  private async reprice(
    manager: EntityManager,
    booking: Booking,
    patch: BookingPatch,
  ): Promise<void> {
    const existing = await manager.find(BookingLine, {
      // every paid line: experiences and products (the park-entry row has neither)
      where: [{ bookingId: booking.id, experienceId: Not(IsNull()) }, { bookingId: booking.id, productKey: Not(IsNull()) }],
      order: LINE_ORDER,
    });
    const items = repricingItems(patch, existing);
    const [experiences, settings, priceRows, products] = await Promise.all([
      manager.find(Experience),
      manager.find(Setting),
      manager.find(PriceListEntry),
      manager.find(Product),
    ]);

    const priced = computeBooking(
      experiences,
      entrySettings(settingsMap(settings)),
      { adults: patch.adults ?? booking.adults, kids: patch.kids ?? booking.kids, infants: patch.infants ?? booking.infants ?? 0, rate: patch.rate ?? booking.rate, items },
      priceRows,
      products,
    );

    booking.entryAmount = priced.entry;
    booking.subtotal = priced.subtotal;
    booking.discount = priced.discount;
    await this.applyAdjustment(manager, booking, patch, priced);

    await manager.delete(BookingLine, { bookingId: booking.id });
    await manager.save(lineRecords(booking.id, priced.lines).map((line) => manager.create(BookingLine, line)));
  }

  /** FOC pass / discount / coupon: a coupon's offer wins over a manual kind. Sets the adjustment and the total. */
  private async applyAdjustment(manager: EntityManager, booking: Booking, patch: BookingPatch, priced: PricedBooking): Promise<void> {
    if (patch.couponCode !== undefined) {
      if (patch.couponCode) {
        const offer = await this.coupons.resolve(patch.couponCode, manager);
        booking.couponCode = offer.code;
        booking.adjustmentKind = offer.kind;
        booking.adjustmentValue = offer.value;
        booking.adjustmentNote = offer.note || `Code ${offer.code}`;
        await this.coupons.consume(offer.code, manager);
      } else {
        booking.couponCode = '';
        booking.adjustmentKind = 'none';
        booking.adjustmentValue = 0;
        booking.adjustmentNote = '';
      }
    }
    if (patch.adjustmentKind !== undefined) booking.adjustmentKind = patch.adjustmentKind;
    if (patch.adjustmentValue !== undefined) booking.adjustmentValue = patch.adjustmentValue;
    if (patch.adjustmentNote !== undefined) booking.adjustmentNote = patch.adjustmentNote;
    if (booking.adjustmentKind === 'none') { booking.adjustmentValue = 0; booking.adjustmentNote = patch.adjustmentNote ?? ''; }
    booking.adjustmentAmount = adjustmentAmount(booking.adjustmentKind as AdjustmentKind, booking.adjustmentValue, priced);
    booking.total = priced.total - booking.adjustmentAmount;
  }

  private async writeAudit(manager: EntityManager, booking: Booking, by: Actor, action: BookingAuditAction, changes: BookingAuditChanges): Promise<void> {
    await manager.save(manager.create(BookingAudit, auditRecord(booking.id, by, action, changes)));
  }

  /** Reads the lines and the trail through the caller's manager (same transaction). */
  private async readDetail(
    manager: EntityManager,
    booking: Booking,
  ): Promise<BookingDetail> {
    const [lines, audit] = await Promise.all([
      manager.find(BookingLine, { where: { bookingId: booking.id }, order: LINE_ORDER }),
      manager.find(BookingAudit, { where: { bookingId: booking.id }, order: AUDIT_ORDER, take: AUDIT_LIMIT }),
    ]);
    return this.withTicket(toBookingDetail(booking, lines, audit));
  }

  // ------------------------------------------------------------------- quotes

  async listQuotes(query: PageQueryDto): Promise<Paged<QuoteRow>> {
    const paging = resolvePaging(query);

    const [rows, total] = await this.quoteRepo
      .createQueryBuilder('q')
      .orderBy('q.createdAt', 'DESC')
      .skip(pageOffset(paging))
      .take(paging.pageSize)
      .getManyAndCount();

    return { items: rows.map(toQuoteRow), total, ...paging };
  }

  // -------------------------------------------------------------------- stats

  async stats(): Promise<StaffStats> {
    const today = parkToday();

    const [bookingsToday, arrivalsToday, revenueRaw, openChats] =
      await Promise.all([
        // created_at is a timestamptz, so shift it into the park's zone before
        // taking the calendar date, or late-evening bookings land on the wrong day.
        this.bookingRepo
          .createQueryBuilder('b')
          .where('(b.createdAt AT TIME ZONE CAST(:tz AS text))::date = :today', {
            tz: PARK_TZ,
            today,
          })
          .getCount(),

        this.visitsOn(today).getCount(),

        this.createdBetween(startOfMonth(today), startOfNextMonth(today))
          .andWhere('b.status <> :cancelled', { cancelled: 'cancelled' })
          .select('COALESCE(SUM(b.total), 0)', 'sum')
          .getRawOne<{ sum: string | number | null }>(),

        this.openChats().getCount(),
      ]);
    const [todayRaw, unansweredChats] = await Promise.all([
      this.visitsOn(today)
        .select('COALESCE(SUM(b.total), 0)', 'sum')
        .addSelect('COALESCE(SUM(b.adults + b.kids + b.infants), 0)', 'guests')
        .getRawOne<{ sum: string | number | null; guests: string | number | null }>(),
      this.openChats().andWhere('c.unreadStaff > 0').getCount(),
    ]);

    return {
      bookingsToday,
      arrivalsToday,
      openChats,
      unansweredChats,
      guestsToday: Number(todayRaw?.guests ?? 0),
      revenueToday: Number(todayRaw?.sum ?? 0),
      revenueMonth: Number(revenueRaw?.sum ?? 0),
    };
  }

  /**
   * Open conversations a visitor has actually written in. Opening the chat
   * widget creates an empty thread; those are not chats anyone has to answer.
   */
  private openChats(): SelectQueryBuilder<ChatConversation> {
    return this.chatRepo
      .createQueryBuilder('c')
      .where('c.status = :open', { open: 'open' })
      .andWhere("EXISTS (SELECT 1 FROM chat_messages m WHERE m.conversation_id = c.id AND m.sender = 'visitor')");
  }

  /** Bookings due on site that day, cancellations excluded. */
  private visitsOn(day: string): SelectQueryBuilder<Booking> {
    return this.bookingRepo
      .createQueryBuilder('b')
      .where('b.visitDate = :today', { today: day })
      .andWhere('b.status <> :cancelled', { cancelled: 'cancelled' });
  }

  /** Bookings created within `[from, to)`, in park-local calendar days. */
  private createdBetween(
    from: string,
    to: string,
  ): SelectQueryBuilder<Booking> {
    return this.bookingRepo
      .createQueryBuilder('b')
      .where('(b.createdAt AT TIME ZONE CAST(:tz AS text))::date >= :from', {
        tz: PARK_TZ,
        from,
      })
      .andWhere('(b.createdAt AT TIME ZONE CAST(:tz AS text))::date < :to', {
        to,
      });
  }
}

// --------------------------------------------------------------------- helpers

/**
 * The booking row, locked for the rest of the transaction: two operators
 * editing the same reservation would otherwise race on the re-priced totals.
 */
async function lockOr404(manager: EntityManager, refCode: string): Promise<Booking> {
  const booking = await manager.findOne(Booking, { where: { refCode }, lock: { mode: 'pessimistic_write' } });
  if (!booking) throw noBooking(refCode);
  return booking;
}

/** "  Ana   Peirce " -> ["Ana", "Peirce"]: trimmed, runs of spaces collapsed, at most 6 words. */
export function searchTerms(q: string | undefined): string[] {
  return (q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 6);
}

/** % and _ typed by an operator are literal characters, not wildcards. */
const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => '\\' + c);

/** How the internal note names the channel a desk booking came in by. */
const CHANNEL_LABEL: Record<string, string> = {
  phone: 'phone', desk: 'desk walk-in', email: 'e-mail', whatsapp: 'WhatsApp', agency: 'agency / hotel', other: 'other',
};

/**
 * Optimistic concurrency: the screen sent the `updatedAt` it was showing; if
 * the row has moved since, someone else saved in between.
 */
export function assertNotStale(booking: Booking, expected: string | undefined): void {
  if (!expected || !booking.updatedAt) return;
  if (new Date(expected).getTime() !== new Date(booking.updatedAt).getTime()) {
    throw new ConflictException({
      statusCode: 409, error: 'Conflict', code: 'STALE_BOOKING',
      message: 'This booking was changed by someone else — reload',
    });
  }
}

/** Stamps who last changed the booking, and when. */
function touch(booking: Booking, by: Actor): void {
  booking.updatedAt = new Date();
  booking.updatedBy = by.id;
}

/** The list's filters, each one bound as a parameter. */
function filterBookings(qb: SelectQueryBuilder<Booking>, query: ListBookingsQueryDto): SelectQueryBuilder<Booking> {
  if (query.status) {
    qb.andWhere('b.status = :status', { status: query.status });
  }
  if (query.from) {
    qb.andWhere('b.visitDate >= :from', { from: query.from });
  }
  if (query.to) {
    qb.andWhere('b.visitDate <= :to', { to: query.to });
  }
  if (query.slot) qb.andWhere('b.slot = :slot', { slot: query.slot });
  if (query.payMode) qb.andWhere('b.payMode = :payMode', { payMode: query.payMode });
  if (query.rate) qb.andWhere('b.rate = :rate', { rate: query.rate });
  if (query.nationality) qb.andWhere('b.nationality = :nationality', { nationality: query.nationality });
  searchTerms(query.q).forEach((term, i) => {
    // Every word must match one of the four columns ("ana 2857", "VAL 2857 26").
    // Bound parameters only: the wildcards are added here, never by concatenating
    // the term into the SQL text. Digits also match the phone with its spaces removed.
    const digits = term.replace(/\D/g, '');
    const phoneDigits = digits.length >= 3 ? ` OR regexp_replace(b.phone, '[^0-9]', '', 'g') LIKE :d${i}` : '';
    qb.andWhere(
      `(b.refCode ILIKE :q${i} OR b.guestName ILIKE :q${i} OR b.email ILIKE :q${i} OR b.phone ILIKE :q${i}${phoneDigits})`,
      { [`q${i}`]: `%${escapeLike(term)}%`, ...(phoneDigits ? { [`d${i}`]: `%${digits}%` } : {}) },
    );
  });
  return qb;
}

/** The desk edit a guest's ticket-page change amounts to. */
function guestPatch(booking: Booking, dto: GuestChangeDto): UpdateBookingDto {
  const patch: UpdateBookingDto = {};
  if (dto.visitDate !== undefined) {
    if (dto.visitDate < parkToday()) throw new BadRequestException('visitDate cannot be in the past');
    patch.visitDate = dto.visitDate;
    if (booking.status === 'postponed') patch.status = 'confirmed';
  }
  if (dto.slot !== undefined) patch.slot = dto.slot;
  if (dto.adults !== undefined) patch.adults = dto.adults;
  if (dto.kids !== undefined) patch.kids = dto.kids;
  if (dto.infants !== undefined) patch.infants = dto.infants;
  if (dto.items !== undefined) patch.items = dto.items;
  if (Object.keys(patch).length === 0) throw new BadRequestException('Nothing to change');
  return patch;
}

/** "date -> 2026-11-21, party -> 3 adults, 1 children" for the desk's e-mail. */
function describeGuestChange(dto: GuestChangeDto, detail: BookingDetail): string {
  return [
    dto.visitDate !== undefined ? `date -> ${dto.visitDate}` : '',
    dto.slot !== undefined ? `slot -> ${dto.slot}` : '',
    dto.adults !== undefined || dto.kids !== undefined || dto.infants !== undefined ? `party -> ${detail.adults} adults, ${detail.kids} children, ${detail.infants ?? 0} under 6` : '',
    dto.items !== undefined ? 'experiences changed' : '',
  ].filter(Boolean).join(', ');
}
