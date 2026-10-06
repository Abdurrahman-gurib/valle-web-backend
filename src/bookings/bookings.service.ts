import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { ChatGateway } from '../chat/chat.gateway';
import { Booking, BookingLine, Experience, PriceListEntry, Setting, SlotHold } from '../entities';
import { activityLevel, closureFor, HOLD_MINUTES, parseCalendar, reservePlaces, type Calendar, type ClosureKind, type ExperienceInfo, type SlotKey } from './capacity';
import { BookingNotifierService } from '../notifications/booking-notifier.service';
import { GuestMessagingService } from '../notifications/guest-messaging.service';
import { TicketService } from '../tickets/ticket.service';
import { CouponsService } from '../coupons/coupons.service';
import { PaymentsService } from '../payments/payments.service';
import { toBookingRow } from '../staff/bookings/booking-row';
import { CreateBookingDto } from './dto/create-booking.dto';
import { adjustmentAmount, computeBooking, PricedBooking } from './pricing';

export interface BookingResponse {
  refCode: string;
  total: number;
  discount: number;
  /** rupees taken off by a coupon / pass, and why */
  adjustment?: number;
  adjustmentNote?: string;
  couponCode?: string;
  lines: { label: string; amount: number }[];
  status: string;
  /** The guest's ticket page (QR inside); also e-mailed / WhatsApped. */
  ticketUrl?: string;
  qrUrl?: string;
  /** "Pay online now" with a provider configured: send the guest here; the ticket follows the payment. */
  checkoutUrl?: string;
  paymentId?: string;
}

const REF_MAX_TRIES = 20;
const PG_UNIQUE_VIOLATION = '23505';

/** How busy an arrival slot is, for the date picker. */
export type BusyLevel = 'quiet' | 'busy' | 'very-busy' | 'full' | 'closed';
export interface SlotLoad { bookings: number; guests: number; level: BusyLevel; closure?: { kind: ClosureKind; reason: string } }
export interface AvailabilityDay {
  date: string;
  morning: SlotLoad;
  afternoon: SlotLoad;
  /** Only experiences with a capacity: how full each slot is for them. */
  activities?: Record<string, { morning: 'quiet' | 'busy' | 'full'; afternoon: 'quiet' | 'busy' | 'full' }>;
}

export const AVAILABILITY_MAX_DAYS = 62;

export function busyLevel(guests: number, capacity: number): BusyLevel {
  const share = guests / capacity;
  if (share >= 1) return 'full';
  if (share >= 0.7) return 'very-busy';
  if (share >= 0.35) return 'busy';
  return 'quiet';
}

const addDays = (iso: string, n: number): string => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dateOf = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

@Injectable()
export class BookingsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(BookingLine)
    private readonly lineRepo: Repository<BookingLine>,
    @InjectRepository(Experience)
    private readonly experienceRepo: Repository<Experience>,
    @InjectRepository(PriceListEntry)
    private readonly priceRepo: Repository<PriceListEntry>,
    @InjectRepository(Setting)
    private readonly settingRepo: Repository<Setting>,
    @InjectRepository(SlotHold)
    private readonly holdRepo: Repository<SlotHold>,
    @Optional() private readonly notifier?: BookingNotifierService,
    @Optional() private readonly gateway?: ChatGateway,
    @Optional() private readonly guest?: GuestMessagingService,
    @Optional() private readonly tickets?: TicketService,
    @Optional() config?: ConfigService,
    @Optional() private readonly coupons?: CouponsService,
    @Optional() private readonly payments?: PaymentsService,
  ) {
    const cap = Number(config?.get<string>('BOOKING_SLOT_CAPACITY') ?? '');
    this.envSlotCapacity = Number.isFinite(cap) && cap > 0 ? cap : undefined;
  }

  private readonly logger = new Logger(BookingsService.name);
  private readonly envSlotCapacity: number | undefined;

  /** The capacity calendar as edited in the back office (slot capacity, closures, per-activity limits). */
  async calendar(): Promise<Calendar> {
    const settings = await this.settingRepo.find();
    return parseCalendar(new Map(settings.map((x) => [x.key, x.value])), this.envSlotCapacity);
  }

  /** name + price mode per experience, for the capacity check's wording and units. */
  async experienceInfo(): Promise<Map<string, ExperienceInfo>> {
    const rows = await this.experienceRepo.find();
    return new Map(rows.map((e) => [e.id, { name: e.name, priceMode: e.priceMode }]));
  }

  /**
   * Bookings per arrival slot for the date picker: how many parties and guests
   * already hold each morning / afternoon, as a level rather than raw counts
   * that the public could read too much into. Cancelled bookings do not count.
   */
  async availability(from: string, days: number): Promise<AvailabilityDay[]> {
    const n = Math.min(Math.max(1, days), AVAILABILITY_MAX_DAYS);
    const to = addDays(from, n - 1);
    const cal = await this.calendar();
    const rows = await this.bookingRepo
      .createQueryBuilder('b')
      .select('b.visitDate', 'date')
      .addSelect('b.slot', 'slot')
      .addSelect('COUNT(*)', 'bookings')
      .addSelect('COALESCE(SUM(b.adults + b.kids), 0)', 'guests')
      .where('b.visitDate BETWEEN :from AND :to', { from, to })
      .andWhere('b.status NOT IN (:...gone)', { gone: ['cancelled', 'postponed'] })
      .groupBy('b.visitDate')
      .addGroupBy('b.slot')
      .getRawMany<{ date: unknown; slot: string; bookings: string; guests: string }>();
    // places held mid-form count like bookings until they expire
    const held = await this.holdRepo
      .createQueryBuilder('h')
      .select('h.visitDate', 'date')
      .addSelect('h.slot', 'slot')
      .addSelect('COALESCE(SUM(h.adults + h.kids), 0)', 'guests')
      .where('h.visitDate BETWEEN :from AND :to', { from, to })
      .andWhere('h.expiresAt > now()')
      .groupBy('h.visitDate')
      .addGroupBy('h.slot')
      .getRawMany<{ date: unknown; slot: string; guests: string }>();

    const byDate = new Map<string, AvailabilityDay>();
    const empty = (): SlotLoad => ({ bookings: 0, guests: 0, level: 'quiet' });
    for (let i = 0; i < n; i++) {
      const date = addDays(from, i);
      byDate.set(date, { date, morning: empty(), afternoon: empty() });
    }
    for (const r of rows) {
      const day = byDate.get(dateOf(r.date));
      if (!day || (r.slot !== 'morning' && r.slot !== 'afternoon')) continue;
      day[r.slot] = { bookings: Number(r.bookings) || 0, guests: Number(r.guests) || 0, level: 'quiet' };
    }
    for (const r of held) {
      const day = byDate.get(dateOf(r.date));
      if (!day || (r.slot !== 'morning' && r.slot !== 'afternoon')) continue;
      day[r.slot].guests += Number(r.guests) || 0;
    }
    for (const day of byDate.values()) {
      for (const slot of ['morning', 'afternoon'] as SlotKey[]) {
        const closure = closureFor(day.date, slot, cal.closures);
        day[slot].level = closure ? 'closed' : busyLevel(day[slot].guests, cal.slotCapacity);
        if (closure) day[slot].closure = { kind: closure.kind, reason: closure.reason };
      }
    }

    // per-activity levels, only for experiences that have a capacity
    const capped = Object.keys(cal.activityCapacity);
    if (capped.length > 0) {
      const taken = await this.activityTakenInRange(from, to, capped);
      const experiences = await this.experienceInfo();
      for (const day of byDate.values()) {
        day.activities = {};
        for (const id of capped) {
          const cap = cal.activityCapacity[id];
          const perPerson = experiences.get(id)?.priceMode !== 'flat';
          const get = (slot: SlotKey) => taken.get(`${day.date}|${slot}|${id}|${perPerson ? 'pp' : 'u'}`) ?? 0;
          day.activities[id] = { morning: activityLevel(get('morning'), cap.morning), afternoon: activityLevel(get('afternoon'), cap.afternoon) };
        }
      }
    }
    return [...byDate.values()];
  }

  /** "date|slot|experience|pp|u" -> guests or units already taken (bookings + live holds). */
  private async activityTakenInRange(from: string, to: string, ids: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const add = (k: string, v: number) => out.set(k, (out.get(k) ?? 0) + v);
    const booked = await this.dataSource.query(
      `SELECT b.visit_date::text AS date, b.slot, l.experience_id AS id, COALESCE(SUM(l.adults + l.kids), 0)::int AS pp, COALESCE(SUM(l.units), 0)::int AS u
       FROM booking_lines l JOIN bookings b ON b.id = l.booking_id
       WHERE b.visit_date BETWEEN $1 AND $2 AND b.status NOT IN ('cancelled','postponed') AND l.experience_id = ANY($3)
       GROUP BY b.visit_date, b.slot, l.experience_id`,
      [from, to, ids],
    ) as { date: string; slot: string; id: string; pp: number; u: number }[];
    for (const r of booked) { add(`${r.date.slice(0, 10)}|${r.slot}|${r.id}|pp`, Number(r.pp) || 0); add(`${r.date.slice(0, 10)}|${r.slot}|${r.id}|u`, Number(r.u) || 0); }
    const held = await this.dataSource.query(
      `SELECT h.visit_date::text AS date, h.slot, i->>'id' AS id,
              COALESCE(SUM(COALESCE((i->>'adults')::int, 0) + COALESCE((i->>'kids')::int, 0)), 0)::int AS pp,
              COALESCE(SUM(COALESCE((i->>'units')::int, 0)), 0)::int AS u
       FROM slot_holds h, jsonb_array_elements(h.items) i
       WHERE h.visit_date BETWEEN $1 AND $2 AND h.expires_at > now() AND i->>'id' = ANY($3)
       GROUP BY h.visit_date, h.slot, i->>'id'`,
      [from, to, ids],
    ) as { date: string; slot: string; id: string; pp: number; u: number }[];
    for (const r of held) { add(`${r.date.slice(0, 10)}|${r.slot}|${r.id}|pp`, Number(r.pp) || 0); add(`${r.date.slice(0, 10)}|${r.slot}|${r.id}|u`, Number(r.u) || 0); }
    return out;
  }

  // ------------------------------------------------------------------ holds

  /**
   * Holds the party's places for HOLD_MINUTES while the guest types their
   * details. Checked like a booking (closures, slot and activity capacity);
   * an earlier hold of the same guest is replaced.
   */
  async hold(input: { visitDate: string; slot: SlotKey; adults: number; kids: number; items: { id: string; adults?: number; kids?: number; units?: number }[]; holdId?: string }): Promise<{ holdId: string; expiresAt: string }> {
    const [cal, experiences] = await Promise.all([this.calendar(), this.experienceInfo()]);
    const visitDate = input.visitDate.slice(0, 10);
    return this.dataSource.transaction(async (manager) => {
      if (input.holdId) await manager.delete(SlotHold, { id: input.holdId });
      await reservePlaces(manager, { ...input, visitDate }, cal, experiences);
      const saved = await manager.save(SlotHold, manager.create(SlotHold, {
        visitDate, slot: input.slot, adults: input.adults, kids: input.kids, items: input.items.map((i) => ({ id: i.id, adults: i.adults ?? 0, kids: i.kids ?? 0, units: i.units ?? 0 })),
        expiresAt: new Date(Date.now() + HOLD_MINUTES * 60_000),
      }));
      return { holdId: saved.id, expiresAt: saved.expiresAt.toISOString() };
    });
  }

  async releaseHold(holdId: string): Promise<void> {
    await this.holdRepo.delete({ id: holdId });
  }

  /** Tells the back office about a new booking: live socket first, then e-mail. Never throws. */
  private async notifyStaff(booking: Booking, lines: BookingLine[]): Promise<void> {
    this.logger.log(`Booking ${booking.refCode}: announcing to the staff room (gateway ${this.gateway ? 'wired' : 'absent'}, mail ${this.notifier?.enabled ? 'on' : 'off'})`);
    try {
      await this.gateway?.announceBooking(toBookingRow(booking));
    } catch (e) {
      this.logger.warn(`Live booking notice for ${booking.refCode} failed: ${(e as Error).message}`);
    }
    await this.notifier?.notifyNewBooking(booking, lines);
  }

  async create(dto: CreateBookingDto): Promise<BookingResponse> {
    const email = (dto.email ?? '').trim();
    const phone = (dto.phone ?? '').trim();
    if (!email && !phone) {
      throw new BadRequestException(
        'Provide at least an email address or a phone number',
      );
    }

    const visitDate = dto.visitDate.slice(0, 10);
    // "Today" is whatever day it is at the park, not on the server.
    const today = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Indian/Mauritius',
    }); // YYYY-MM-DD
    if (visitDate < today) {
      throw new BadRequestException('visitDate cannot be in the past');
    }

    const [experiences, settings, priceRows] = await Promise.all([
      this.experienceRepo.find(),
      this.settingRepo.find(),
      this.priceRepo.find(),
    ]);
    const settingsMap = new Map(settings.map((s) => [s.key, s.value]));
    const priced = computeBooking(
      experiences,
      {
        entryAdult: parseInt(settingsMap.get('entry_adult') ?? '500', 10),
        entryChild: parseInt(settingsMap.get('entry_child') ?? '250', 10),
      },
      {
        adults: dto.adults,
        kids: dto.kids,
        rate: dto.rate,
        items: dto.items,
      },
      priceRows,
    );

    // A promo / partner code: validated now, counted inside the booking transaction.
    const offer = dto.couponCode && this.coupons ? await this.coupons.resolve(dto.couponCode) : null;
    const adjustment = offer ? { kind: offer.kind, value: offer.value, amount: adjustmentAmount(offer.kind, offer.value, priced), note: offer.note, code: offer.code } : null;

    const [cal, experienceInfo] = await Promise.all([this.calendar(), this.experienceInfo()]);

    for (let attempt = 0; attempt < REF_MAX_TRIES; attempt++) {
      const refCode = this.generateRefCode();
      try {
        return await this.persist(dto, priced, refCode, email, phone, visitDate, adjustment, cal, experienceInfo);
      } catch (err) {
        if (this.isUniqueViolation(err)) continue; // ref collision, retry
        throw err;
      }
    }
    throw new ConflictException(
      'Could not allocate a unique booking reference, please try again',
    );
  }

  // ------------------------------------------------------------------ helpers

  private async persist(
    dto: CreateBookingDto,
    priced: PricedBooking,
    refCode: string,
    email: string,
    phone: string,
    visitDate: string,
    adjustment: { kind: string; value: number; amount: number; note: string; code: string } | null = null,
    cal?: Calendar,
    experienceInfo?: Map<string, ExperienceInfo>,
  ): Promise<BookingResponse> {
    const { saved, lines } = await this.dataSource.transaction(async (manager) => {
      // The slot, the day and every capped activity must really have room: the picker is only advisory.
      await reservePlaces(
        manager,
        { visitDate, slot: dto.slot, adults: dto.adults, kids: dto.kids, items: dto.items, holdId: dto.holdId },
        cal ?? (await this.calendar()),
        experienceInfo ?? (await this.experienceInfo()),
      );
      if (dto.holdId) await manager.delete(SlotHold, { id: dto.holdId });
      const booking = manager.create(Booking, {
        refCode,
        visitDate,
        slot: dto.slot,
        adults: dto.adults,
        kids: dto.kids,
        rate: dto.rate,
        guestName: dto.name,
        phone,
        email,
        nationality: (dto.nationality ?? '').trim(),
        payMode: dto.payMode,
        status: 'confirmed',
        entryAmount: priced.entry,
        subtotal: priced.subtotal,
        discount: priced.discount,
        total: priced.total - (adjustment?.amount ?? 0),
        currency: 'MUR',
        adjustmentKind: adjustment?.kind ?? 'none',
        adjustmentValue: adjustment?.value ?? 0,
        adjustmentAmount: adjustment?.amount ?? 0,
        adjustmentNote: adjustment?.note ?? '',
        couponCode: adjustment?.code ?? '',
      });
      const saved = await manager.save(booking);
      if (adjustment && this.coupons) await this.coupons.consume(adjustment.code, manager);

      const lines = priced.lines.map((l, i) =>
        manager.create(BookingLine, {
          bookingId: saved.id,
          experienceId: l.experienceId,
          variant: l.variant,
          label: l.label,
          adults: l.adults,
          kids: l.kids,
          units: l.units,
          amount: l.amount,
          sortOrder: i,
        }),
      );
      await manager.save(lines);
      return { saved, lines };
    });

    // After the commit, so the desk is never told about a booking that rolled back.
    void this.notifyStaff(saved, lines);

    // "Pay online now" with a gateway configured: open the checkout and hold the
    // ticket until the money arrives (PaymentsService sends it on the webhook, or
    // as pay-on-arrival once the checkout is abandoned). Without a gateway the
    // choice means nothing and the booking is a pay-on-arrival one.
    let checkout: { paymentId: string; checkoutUrl: string } | null = null;
    if (dto.payMode === 'online' && this.payments?.enabled) {
      try {
        checkout = await this.payments.startCheckout(saved);
      } catch (e) {
        this.logger.warn(`Checkout for ${saved.refCode} could not be opened: ${(e as Error).message}`);
      }
    }
    if (!checkout) {
      // The guest's ticket (e-mail with QR, WhatsApp when configured). Never blocks the response.
      void this.guest?.sendTicket(saved, lines).catch((e: Error) => this.logger.warn(`Ticket for ${saved.refCode} not sent: ${e.message}`));
    }

    return {
      refCode: saved.refCode,
      total: saved.total,
      discount: saved.discount,
      adjustment: saved.adjustmentAmount,
      adjustmentNote: saved.adjustmentNote,
      couponCode: saved.couponCode,
      lines: priced.lines.map((l) => ({ label: l.label, amount: l.amount })),
      status: saved.status,
      ticketUrl: this.tickets?.ticketUrl(saved.refCode),
      qrUrl: this.tickets?.qrUrl(saved.refCode),
      ...(checkout ? { checkoutUrl: checkout.checkoutUrl, paymentId: checkout.paymentId } : {}),
    };
  }

  /** 'VAL-' + 4 random digits (1000..9999) + '-26' */
  private generateRefCode(): string {
    const digits = 1000 + Math.floor(Math.random() * 9000);
    return `VAL-${digits}-26`;
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      err instanceof QueryFailedError &&
      (err as QueryFailedError & { driverError?: { code?: string } })
        .driverError?.code === PG_UNIQUE_VIOLATION
    );
  }
}
