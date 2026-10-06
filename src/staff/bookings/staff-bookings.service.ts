import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  IsNull,
  Not,
  Repository,
  SelectQueryBuilder,
  MoreThan,
} from 'typeorm';
import { adjustmentAmount, computeBooking, PricedBooking, type AdjustmentKind } from '../../bookings/pricing';
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
  Setting, PriceListEntry } from '../../entities';
import type { StaffPrincipal } from '../auth/staff-auth.types';
import {
  BookingStatus,
  DEFAULT_PAGE_SIZE,
  ListBookingsQueryDto,
  MAX_PAGE_SIZE,
  PageQueryDto,
} from './dto/list-bookings.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { CreateStaffBookingDto } from './dto/create-staff-booking.dto';
import { BookingsService } from '../../bookings/bookings.service';
import { TicketService } from '../../tickets/ticket.service';
import { GuestMessagingService } from '../../notifications/guest-messaging.service';

/** The park's wall clock: "today" is whatever day it is on site, not on the server. */
const PARK_TZ = 'Indian/Mauritius';

/** Editing any of these re-prices the booking from its own experience lines. */
const MONEY_FIELDS = ['adults', 'kids', 'rate', 'items', 'adjustmentKind', 'adjustmentValue', 'adjustmentNote', 'couponCode'] as const;

/** How many audit entries the drawer shows. */
const AUDIT_LIMIT = 20;

export { toBookingRow, type BookingRow } from './booking-row';
import { toBookingRow, toDateString, toIso, type BookingRow } from './booking-row';

export interface BookingLineRow {
  /** null for the park-entry line */
  experienceId: string | null;
  variant: string;
  label: string;
  adults: number;
  kids: number;
  units: number;
  amount: number;
}

/** One entry of the reservation's change history. Back office only. */
export interface BookingAuditRow {
  /** ISO 8601 */
  at: string;
  staffEmail: string;
  action: BookingAuditAction;
  changes: BookingAuditChanges;
}

/**
 * The detail view adds the staff-only fields: the internal note and the audit
 * trail. Never reachable from a public endpoint.
 */
export type BookingDetail = BookingRow & {
  staffNote: string;
  /** The guest's ticket page; what the desk forwards by WhatsApp / e-mail. */
  ticketUrl?: string;
  ticketSentAt?: string | null;
  reminderSentAt?: string | null;
  lines: BookingLineRow[];
  /** Most recent first, at most AUDIT_LIMIT entries. */
  audit: BookingAuditRow[];
};

export interface QuoteRow {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  groupSize: string;
  preferredDate: string;
  message: string;
  /** ISO 8601 */
  createdAt: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StaffStats {
  /** Bookings created today. */
  bookingsToday: number;
  /** Bookings due on site today (visit_date), cancellations excluded. */
  arrivalsToday: number;
  openChats: number;
  /** Open conversations with a visitor message nobody has answered yet. */
  unansweredChats: number;
  /** Guests (adults + children) due on site today, cancellations excluded. */
  guestsToday: number;
  /** SUM(total) of today's visits, cancellations excluded. */
  revenueToday: number;
  /** SUM(total) of bookings created this calendar month, cancellations excluded. */
  revenueMonth: number;
}

/** The editable subset of a booking, normalised (trimmed) and fully typed. */
interface BookingPatch {
  visitDate?: string;
  slot?: 'morning' | 'afternoon';
  adults?: number;
  kids?: number;
  rate?: 'rr' | 'nr';
  guestName?: string;
  phone?: string;
  email?: string;
  nationality?: string;
  payMode?: 'gate' | 'online';
  status?: BookingStatus;
  staffNote?: string;
  /** JSON of the requested experience lines (compared as text for the audit trail). */
  items?: string;
  adjustmentKind?: AdjustmentKind;
  adjustmentValue?: number;
  adjustmentNote?: string;
  couponCode?: string;
}

type PatchField = keyof BookingPatch;

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
  ) {}

  // ----------------------------------------------------------------- bookings

  async list(query: ListBookingsQueryDto): Promise<Paged<BookingRow>> {
    const { page, pageSize } = resolvePaging(query);
    const qb = this.bookingRepo.createQueryBuilder('b');

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
    const term = query.q?.trim();
    if (term) {
      // One bound parameter reused across the four columns; the wildcards are
      // added here, never by concatenating the term into the SQL text.
      qb.andWhere(
        '(b.refCode ILIKE :q OR b.guestName ILIKE :q OR b.email ILIKE :q OR b.phone ILIKE :q)',
        { q: `%${term}%` },
      );
    }

    const order: Record<string, [string, 'ASC' | 'DESC']> = {
      newest: ['b.createdAt', 'DESC'], oldest: ['b.createdAt', 'ASC'], visit_asc: ['b.visitDate', 'ASC'],
      visit_desc: ['b.visitDate', 'DESC'], total_desc: ['b.total', 'DESC'], total_asc: ['b.total', 'ASC'], guest: ['b.guestName', 'ASC'],
    };
    const [col, dir] = order[query.sort ?? 'newest'] ?? order.newest;
    const [rows, total] = await qb
      .orderBy(col, dir)
      .addOrderBy('b.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return { items: rows.map(toBookingRow), total, page, pageSize };
  }

  /**
   * A booking taken by an operator (phone, front desk, e-mail, WhatsApp). Priced
   * and validated exactly like a website booking, then stamped with who took it
   * and through which channel, so the trail starts with a 'create' entry.
   */
  async createForGuest(dto: CreateStaffBookingDto, staff: StaffPrincipal): Promise<BookingDetail> {
    const { channel, note, ...bookingDto } = dto;
    const created = await this.bookings.create(bookingDto);
    const booking = await this.bookingRepo.findOne({ where: { refCode: created.refCode } });
    if (!booking) throw new NotFoundException(`No booking ${created.refCode}`);
    const stamp = `Taken by ${staff.name} (${channel})`;
    booking.staffNote = [stamp, (note ?? '').trim()].filter(Boolean).join('\n');
    // "Paid online / by transfer" in the drawer means the money has arrived: record it,
    // otherwise the guest's ticket would still ask them to pay at the gate.
    if (bookingDto.payMode === 'online') {
      booking.paidAmount = booking.total;
      booking.paidAt = new Date();
      booking.paymentMethod = 'online';
    }
    booking.updatedAt = new Date();
    booking.updatedBy = staff.id;
    await this.bookingRepo.save(booking);
    await this.auditRepo.save(
      this.auditRepo.create({
        bookingId: booking.id,
        staffId: staff.id,
        staffEmail: staff.email,
        action: 'create',
        changes: { channel: { from: null, to: channel } },
      }),
    );
    return this.detail(booking.refCode);
  }

  async detail(refCode: string): Promise<BookingDetail> {
    const booking = await this.bookingRepo.findOne({ where: { refCode } });
    if (!booking) throw new NotFoundException(`No booking ${refCode}`);

    const [lines, audit] = await Promise.all([
      this.lineRepo.find({
        where: { bookingId: booking.id },
        order: { sortOrder: 'ASC' },
      }),
      this.auditRepo.find({
        where: { bookingId: booking.id },
        order: { createdAt: 'DESC', id: 'DESC' },
        take: AUDIT_LIMIT,
      }),
    ]);

    return this.withTicket(toBookingDetail(booking, lines, audit));
  }

  /** Re-send the guest's ticket (e-mail + WhatsApp) after a change of contact details, or on request. */
  async resendTicket(refCode: string): Promise<{ email: boolean; whatsapp: boolean }> {
    const booking = await this.bookingRepo.findOne({ where: { refCode } });
    if (!booking) throw new NotFoundException(`No booking ${refCode}`);
    return this.guest.sendTicket(booking);
  }

  /** The cashier took money: adds to what was paid, keeps the receipt number, writes the trail. */
  async recordPayment(refCode: string, input: { amount: number; method: string; receiptNo?: string }, staff: StaffPrincipal): Promise<BookingDetail> {
    return this.dataSource.transaction(async (manager) => {
      const booking = await manager.findOne(Booking, { where: { refCode }, lock: { mode: 'pessimistic_write' } });
      if (!booking) throw new NotFoundException(`No booking ${refCode}`);
      if (booking.status === 'cancelled') throw new BadRequestException('This booking is cancelled');
      const from = booking.paidAmount;
      booking.paidAmount = from + input.amount;
      booking.paidAt = new Date();
      booking.paymentMethod = input.method;
      if (input.receiptNo?.trim()) booking.receiptNo = input.receiptNo.trim();
      booking.updatedAt = new Date();
      booking.updatedBy = staff.id;
      await manager.save(Booking, booking);
      await manager.save(manager.create(BookingAudit, {
        bookingId: booking.id, staffId: staff.id, staffEmail: staff.email, action: 'edit',
        changes: {
          paidAmount: { from, to: booking.paidAmount },
          paymentMethod: { from: null, to: input.method },
          ...(input.receiptNo?.trim() ? { receiptNo: { from: null, to: input.receiptNo.trim() } } : {}),
        },
      }));
      return this.readDetail(manager, booking);
    });
  }

  /** Weather day: the visit is postponed, money stays on the booking, the guest picks a new date later. */
  async postpone(refCode: string, reason: string, staff: StaffPrincipal): Promise<BookingDetail> {
    return this.dataSource.transaction(async (manager) => {
      const booking = await manager.findOne(Booking, { where: { refCode }, lock: { mode: 'pessimistic_write' } });
      if (!booking) throw new NotFoundException(`No booking ${refCode}`);
      if (booking.status === 'cancelled') throw new BadRequestException('This booking is cancelled');
      const from = booking.status;
      booking.postponedFrom = toDateString(booking.visitDate);
      booking.status = 'postponed';
      booking.updatedAt = new Date();
      booking.updatedBy = staff.id;
      await manager.save(Booking, booking);
      await manager.save(manager.create(BookingAudit, {
        bookingId: booking.id, staffId: staff.id, staffEmail: staff.email, action: 'status',
        changes: { status: { from, to: 'postponed' }, reason: { from: null, to: reason.trim() || 'weather' } },
      }));
      return this.readDetail(manager, booking);
    });
  }

  async receiptPdf(refCode: string): Promise<Buffer> {
    const booking = await this.bookingRepo.findOne({ where: { refCode } });
    if (!booking) throw new NotFoundException(`No booking ${refCode}`);
    const lines = await this.lineRepo.find({ where: { bookingId: booking.id }, order: { sortOrder: 'ASC' } });
    return renderReceiptPdf(booking, lines, { siteUrl: this.tickets.siteUrl });
  }

  async resendWaiverLink(refCode: string): Promise<{ email: boolean; whatsapp: boolean }> {
    const booking = await this.bookingRepo.findOne({ where: { refCode } });
    if (!booking) throw new NotFoundException(`No booking ${refCode}`);
    return this.guest.sendWaiverLink(booking);
  }

  private withTicket(detail: BookingDetail): BookingDetail {
    return { ...detail, ticketUrl: this.tickets.ticketUrl(detail.refCode) };
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
    staff: StaffPrincipal,
  ): Promise<BookingDetail> {
    const patch = normalizePatch(dto);
    const requested = Object.keys(patch) as PatchField[];
    if (requested.length === 0) {
      throw new BadRequestException(
        'Provide at least one field to update',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const booking = await manager.findOne(Booking, {
        where: { refCode },
        // Two operators editing the same reservation would otherwise race on
        // the re-priced totals.
        lock: { mode: 'pessimistic_write' },
      });
      if (!booking) throw new NotFoundException(`No booking ${refCode}`);

      // A booking has to stay reachable, exactly as BookingsService.create insists.
      const nextEmail = patch.email ?? booking.email;
      const nextPhone = patch.phone ?? booking.phone;
      if (!nextEmail && !nextPhone) {
        throw new BadRequestException(
          'Keep at least an email address or a phone number on the booking',
        );
      }

      // Only the fields that really move are audited, so a re-submitted form
      // does not fill the trail with no-ops.
      const changes: BookingAuditChanges = {};
      for (const field of requested) {
        const from = currentValue(booking, field);
        const to = patchValue(patch, field);
        if (to !== undefined && from !== to) changes[field] = { from, to };
      }
      const changed = Object.keys(changes) as PatchField[];
      if (changed.length === 0) {
        // Nothing moved: leave updated_at and the trail alone.
        return this.readDetail(manager, booking);
      }

      if (MONEY_FIELDS.some((field) => field in changes)) {
        await this.reprice(manager, booking, patch);
      }

      applyPatch(booking, patch);
      booking.updatedAt = new Date();
      booking.updatedBy = staff.id;
      await manager.save(Booking, booking);

      await manager.save(
        manager.create(BookingAudit, {
          bookingId: booking.id,
          staffId: staff.id,
          staffEmail: staff.email,
          action: auditAction(changed),
          changes,
        }),
      );

      return this.readDetail(manager, booking);
    });
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
    const adults = patch.adults ?? booking.adults;
    const kids = patch.kids ?? booking.kids;
    const rate = patch.rate ?? booking.rate;

    const existing = await manager.find(BookingLine, {
      where: { bookingId: booking.id, experienceId: Not(IsNull()) },
      order: { sortOrder: 'ASC' },
    });
    const requestedItems = patch.items !== undefined
      ? (JSON.parse(patch.items) as { id: string; variant?: string; adults?: number; kids?: number; units?: number }[])
      : null;
    const [experiences, settings, priceRows] = await Promise.all([
      manager.find(Experience),
      manager.find(Setting),
      manager.find(PriceListEntry),
    ]);
    const settingsMap = new Map(settings.map((s) => [s.key, s.value]));

    const priced: PricedBooking = computeBooking(
      experiences,
      {
        entryAdult: parseInt(settingsMap.get('entry_adult') ?? '500', 10),
        entryChild: parseInt(settingsMap.get('entry_child') ?? '250', 10),
      },
      {
        adults,
        kids,
        rate,
        items: requestedItems ?? existing.map((line) => ({
          // The where clause already excluded the null (park entry) rows.
          id: line.experienceId ?? '',
          variant: line.variant || undefined,
          adults: line.adults,
          kids: line.kids,
          units: line.units,
        })),
      },
      priceRows,
    );

    booking.entryAmount = priced.entry;
    booking.subtotal = priced.subtotal;
    booking.discount = priced.discount;

    // FOC pass / discount / coupon: a coupon's offer wins over a manual kind.
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

    await manager.delete(BookingLine, { bookingId: booking.id });
    await manager.save(
      priced.lines.map((line, i) =>
        manager.create(BookingLine, {
          bookingId: booking.id,
          experienceId: line.experienceId,
          variant: line.variant,
          label: line.label,
          adults: line.adults,
          kids: line.kids,
          units: line.units,
          amount: line.amount,
          sortOrder: i,
        }),
      ),
    );
  }

  /** Reads the lines and the trail through the caller's manager (same transaction). */
  private async readDetail(
    manager: EntityManager,
    booking: Booking,
  ): Promise<BookingDetail> {
    const [lines, audit] = await Promise.all([
      manager.find(BookingLine, {
        where: { bookingId: booking.id },
        order: { sortOrder: 'ASC' },
      }),
      manager.find(BookingAudit, {
        where: { bookingId: booking.id },
        order: { createdAt: 'DESC', id: 'DESC' },
        take: AUDIT_LIMIT,
      }),
    ]);
    return this.withTicket(toBookingDetail(booking, lines, audit));
  }

  // ------------------------------------------------------------------- quotes

  async listQuotes(query: PageQueryDto): Promise<Paged<QuoteRow>> {
    const { page, pageSize } = resolvePaging(query);

    const [rows, total] = await this.quoteRepo
      .createQueryBuilder('q')
      .orderBy('q.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return { items: rows.map(toQuoteRow), total, page, pageSize };
  }

  // -------------------------------------------------------------------- stats

  async stats(): Promise<StaffStats> {
    const today = parkToday();
    const monthStart = startOfMonth(today);
    const nextMonthStart = startOfNextMonth(today);

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

        this.bookingRepo
          .createQueryBuilder('b')
          .where('b.visitDate = :today', { today })
          .andWhere('b.status <> :cancelled', { cancelled: 'cancelled' })
          .getCount(),

        this.createdBetween(monthStart, nextMonthStart)
          .andWhere('b.status <> :cancelled', { cancelled: 'cancelled' })
          .select('COALESCE(SUM(b.total), 0)', 'sum')
          .getRawOne<{ sum: string | number | null }>(),

        this.chatRepo.count({ where: { status: 'open' } }),
      ]);
    const [todayRaw, unansweredChats] = await Promise.all([
      this.bookingRepo
        .createQueryBuilder('b')
        .where('b.visitDate = :today', { today })
        .andWhere('b.status <> :cancelled', { cancelled: 'cancelled' })
        .select('COALESCE(SUM(b.total), 0)', 'sum')
        .addSelect('COALESCE(SUM(b.adults + b.kids), 0)', 'guests')
        .getRawOne<{ sum: string | number | null; guests: string | number | null }>(),
      this.chatRepo.count({ where: { status: 'open', unreadStaff: MoreThan(0) } }),
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
 * The DTOs already validate these, but the service is also called directly
 * (tests, future jobs) so the bounds are enforced here too.
 */
function resolvePaging(query: PageQueryDto): {
  page: number;
  pageSize: number;
} {
  const page = Math.max(1, Math.trunc(Number(query.page) || 1));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.trunc(Number(query.pageSize) || DEFAULT_PAGE_SIZE)),
  );
  return { page, pageSize };
}

/** Today at the park, as YYYY-MM-DD, matching BookingsService.create(). */
function parkToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: PARK_TZ });
}

function startOfMonth(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

function startOfNextMonth(day: string): string {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  return month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

/**
 * Keeps only the fields the operator actually sent, trimmed. Absent keys are
 * left off entirely, so "not sent" stays distinct from "cleared".
 */
function normalizePatch(dto: UpdateBookingDto): BookingPatch {
  const patch: BookingPatch = {};
  if (dto.visitDate !== undefined) {
    patch.visitDate = dto.visitDate.trim().slice(0, 10);
  }
  if (dto.slot !== undefined) patch.slot = dto.slot;
  if (dto.adults !== undefined) patch.adults = dto.adults;
  if (dto.kids !== undefined) patch.kids = dto.kids;
  if (dto.rate !== undefined) patch.rate = dto.rate;
  if (dto.guestName !== undefined) patch.guestName = dto.guestName.trim();
  if (dto.phone !== undefined) patch.phone = dto.phone.trim();
  if (dto.email !== undefined) patch.email = dto.email.trim();
  if (dto.nationality !== undefined) {
    patch.nationality = dto.nationality.trim();
  }
  if (dto.payMode !== undefined) patch.payMode = dto.payMode;
  if (dto.status !== undefined) patch.status = dto.status;
  if (dto.staffNote !== undefined) patch.staffNote = dto.staffNote.trim();
  if (dto.items !== undefined) {
    patch.items = JSON.stringify(dto.items.map((i) => ({ id: i.id, variant: i.variant || undefined, adults: i.adults || 0, kids: i.kids || 0, units: i.units || 0 })));
  }
  if (dto.adjustmentKind !== undefined) patch.adjustmentKind = dto.adjustmentKind;
  if (dto.adjustmentValue !== undefined) patch.adjustmentValue = dto.adjustmentValue;
  if (dto.adjustmentNote !== undefined) patch.adjustmentNote = dto.adjustmentNote.trim();
  if (dto.couponCode !== undefined) patch.couponCode = CouponsService.normalise(dto.couponCode);
  return patch;
}

/** The stored value of an editable field, in the same shape the patch carries. */
function currentValue(b: Booking, field: PatchField): string | number {
  switch (field) {
    case 'visitDate':
      return toDateString(b.visitDate);
    case 'slot':
      return b.slot;
    case 'adults':
      return b.adults;
    case 'kids':
      return b.kids;
    case 'rate':
      return b.rate;
    case 'guestName':
      return b.guestName;
    case 'phone':
      return b.phone;
    case 'email':
      return b.email;
    case 'nationality':
      return b.nationality;
    case 'payMode':
      return b.payMode;
    case 'status':
      return b.status;
    case 'staffNote':
      return b.staffNote;
    case 'items':
      // compared as the requested list; the stored lines are re-read in reprice()
      return '';
    case 'adjustmentKind':
      return b.adjustmentKind ?? 'none';
    case 'adjustmentValue':
      return b.adjustmentValue ?? 0;
    case 'adjustmentNote':
      return b.adjustmentNote ?? '';
    case 'couponCode':
      return b.couponCode ?? '';
  }
}

function patchValue(
  patch: BookingPatch,
  field: PatchField,
): string | number | undefined {
  return patch[field];
}

function applyPatch(b: Booking, patch: BookingPatch): void {
  if (patch.visitDate !== undefined) b.visitDate = patch.visitDate;
  if (patch.slot !== undefined) b.slot = patch.slot;
  if (patch.adults !== undefined) b.adults = patch.adults;
  if (patch.kids !== undefined) b.kids = patch.kids;
  if (patch.rate !== undefined) b.rate = patch.rate;
  if (patch.guestName !== undefined) b.guestName = patch.guestName;
  if (patch.phone !== undefined) b.phone = patch.phone;
  if (patch.email !== undefined) b.email = patch.email;
  if (patch.nationality !== undefined) b.nationality = patch.nationality;
  if (patch.payMode !== undefined) b.payMode = patch.payMode;
  if (patch.status !== undefined) b.status = patch.status;
  if (patch.staffNote !== undefined) b.staffNote = patch.staffNote;
  // items and adjustments are applied by reprice(), which owns the money.
}

/** `edit` unless the operator touched nothing but the status or the note. */
function auditAction(changed: PatchField[]): BookingAuditAction {
  if (changed.length === 1 && changed[0] === 'status') return 'status';
  if (changed.length === 1 && changed[0] === 'staffNote') return 'note';
  return 'edit';
}

/** `date` columns arrive as strings; tolerate a Date in case a driver parses them. */



function toBookingDetail(
  booking: Booking,
  lines: BookingLine[],
  audit: BookingAudit[],
): BookingDetail {
  return {
    ...toBookingRow(booking),
    staffNote: booking.staffNote ?? '',
    ticketSentAt: booking.ticketSentAt ? toIso(booking.ticketSentAt) : null,
    reminderSentAt: booking.reminderSentAt ? toIso(booking.reminderSentAt) : null,
    lines: lines.map((l) => ({
      experienceId: l.experienceId,
      variant: l.variant || '',
      label: l.label,
      adults: l.adults,
      kids: l.kids,
      units: l.units,
      amount: l.amount,
    })),
    audit: audit.map((a) => ({
      at: toIso(a.createdAt),
      staffEmail: a.staffEmail,
      action: a.action,
      changes: a.changes ?? {},
    })),
  };
}

function toQuoteRow(q: Quote): QuoteRow {
  return {
    id: q.id,
    name: q.name,
    company: q.company,
    email: q.email,
    phone: q.phone,
    groupSize: q.groupSize,
    preferredDate: q.preferredDate,
    message: q.message,
    createdAt: toIso(q.createdAt),
  };
}
