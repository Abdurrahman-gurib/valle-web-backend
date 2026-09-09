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
} from 'typeorm';
import { computeBooking, PricedBooking } from '../../bookings/pricing';
import {
  Booking,
  BookingAudit,
  BookingAuditAction,
  BookingAuditChanges,
  BookingLine,
  ChatConversation,
  Experience,
  Quote,
  Setting,
} from '../../entities';
import type { StaffPrincipal } from '../auth/staff-auth.types';
import {
  BookingStatus,
  DEFAULT_PAGE_SIZE,
  ListBookingsQueryDto,
  MAX_PAGE_SIZE,
  PageQueryDto,
} from './dto/list-bookings.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';

/** The park's wall clock: "today" is whatever day it is on site, not on the server. */
const PARK_TZ = 'Indian/Mauritius';

/** Editing any of these re-prices the booking from its own experience lines. */
const MONEY_FIELDS = ['adults', 'kids', 'rate'] as const;

/** How many audit entries the drawer shows. */
const AUDIT_LIMIT = 20;

export interface BookingRow {
  id: string;
  refCode: string;
  /** YYYY-MM-DD */
  visitDate: string;
  slot: string;
  adults: number;
  kids: number;
  rate: string;
  guestName: string;
  email: string;
  phone: string;
  nationality: string;
  payMode: string;
  status: string;
  entryAmount: number;
  subtotal: number;
  discount: number;
  total: number;
  currency: string;
  /** ISO 8601 */
  createdAt: string;
}

export interface BookingLineRow {
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
    const term = query.q?.trim();
    if (term) {
      // One bound parameter reused across the four columns; the wildcards are
      // added here, never by concatenating the term into the SQL text.
      qb.andWhere(
        '(b.refCode ILIKE :q OR b.guestName ILIKE :q OR b.email ILIKE :q OR b.phone ILIKE :q)',
        { q: `%${term}%` },
      );
    }

    const [rows, total] = await qb
      .orderBy('b.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return { items: rows.map(toBookingRow), total, page, pageSize };
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

    return toBookingDetail(booking, lines, audit);
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
    const [experiences, settings] = await Promise.all([
      manager.find(Experience),
      manager.find(Setting),
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
        items: existing.map((line) => ({
          // The where clause already excluded the null (park entry) rows.
          id: line.experienceId ?? '',
          adults: line.adults,
          kids: line.kids,
          units: line.units,
        })),
      },
    );

    booking.entryAmount = priced.entry;
    booking.subtotal = priced.subtotal;
    booking.discount = priced.discount;
    booking.total = priced.total;

    await manager.delete(BookingLine, { bookingId: booking.id });
    await manager.save(
      priced.lines.map((line, i) =>
        manager.create(BookingLine, {
          bookingId: booking.id,
          experienceId: line.experienceId,
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
    return toBookingDetail(booking, lines, audit);
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

    return {
      bookingsToday,
      arrivalsToday,
      openChats,
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
}

/** `edit` unless the operator touched nothing but the status or the note. */
function auditAction(changed: PatchField[]): BookingAuditAction {
  if (changed.length === 1 && changed[0] === 'status') return 'status';
  if (changed.length === 1 && changed[0] === 'staffNote') return 'note';
  return 'edit';
}

/** `date` columns arrive as strings; tolerate a Date in case a driver parses them. */
function toDateString(value: string | Date): string {
  return value instanceof Date
    ? value.toLocaleDateString('en-CA')
    : String(value).slice(0, 10);
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toBookingRow(b: Booking): BookingRow {
  return {
    id: b.id,
    refCode: b.refCode,
    visitDate: toDateString(b.visitDate),
    slot: b.slot,
    adults: b.adults,
    kids: b.kids,
    rate: b.rate,
    guestName: b.guestName,
    email: b.email,
    phone: b.phone,
    nationality: b.nationality,
    payMode: b.payMode,
    status: b.status,
    entryAmount: b.entryAmount,
    subtotal: b.subtotal,
    discount: b.discount,
    total: b.total,
    currency: b.currency,
    createdAt: toIso(b.createdAt),
  };
}

function toBookingDetail(
  booking: Booking,
  lines: BookingLine[],
  audit: BookingAudit[],
): BookingDetail {
  return {
    ...toBookingRow(booking),
    staffNote: booking.staffNote ?? '',
    lines: lines.map((l) => ({
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
