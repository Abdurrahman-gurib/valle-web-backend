import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import { ChatGateway } from '../chat/chat.gateway';
import { Booking, BookingLine, Experience, PriceListEntry, Setting } from '../entities';
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
export type BusyLevel = 'quiet' | 'busy' | 'very-busy' | 'full';
export interface SlotLoad { bookings: number; guests: number; level: BusyLevel }
export interface AvailabilityDay { date: string; morning: SlotLoad; afternoon: SlotLoad }

/** Guests one arrival slot comfortably takes; BOOKING_SLOT_CAPACITY overrides. */
const DEFAULT_SLOT_CAPACITY = 150;
export const AVAILABILITY_MAX_DAYS = 62;

export function busyLevel(guests: number, capacity: number): BusyLevel {
  const share = guests / capacity;
  if (share >= 1) return 'full';
  if (share >= 0.7) return 'very-busy';
  if (share >= 0.35) return 'busy';
  return 'quiet';
}

/** Thrown as 409 when a slot cannot take the party; the page refreshes the picker on it. */
export const SLOT_FULL_MESSAGE = 'That arrival slot is fully booked on this date. Pick the other slot or another day.';

/**
 * Guests already holding (date, slot), counted under a transaction-scoped
 * advisory lock on that slot so two bookings racing for the last places are
 * serialised: the second one sees the first one's guests and is refused.
 * Cancelled and postponed bookings free their places; `exceptId` leaves out
 * the booking being edited.
 */
export async function reserveSlotPlaces(
  manager: EntityManager,
  visitDate: string,
  slot: string,
  party: number,
  capacity: number,
  exceptId?: string,
): Promise<number> {
  await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`slot:${visitDate}:${slot}`]);
  const qb = manager
    .createQueryBuilder(Booking, 'b')
    .select('COALESCE(SUM(b.adults + b.kids), 0)', 'guests')
    .where('b.visitDate = :visitDate', { visitDate })
    .andWhere('b.slot = :slot', { slot })
    .andWhere('b.status NOT IN (:...gone)', { gone: ['cancelled', 'postponed'] });
  if (exceptId) qb.andWhere('b.id != :exceptId', { exceptId });
  const row = await qb.getRawOne<{ guests: string }>();
  const taken = Number(row?.guests) || 0;
  if (taken + party > capacity) throw new ConflictException(SLOT_FULL_MESSAGE);
  return taken;
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
    @Optional() private readonly notifier?: BookingNotifierService,
    @Optional() private readonly gateway?: ChatGateway,
    @Optional() private readonly guest?: GuestMessagingService,
    @Optional() private readonly tickets?: TicketService,
    @Optional() config?: ConfigService,
    @Optional() private readonly coupons?: CouponsService,
    @Optional() private readonly payments?: PaymentsService,
  ) {
    const cap = Number(config?.get<string>('BOOKING_SLOT_CAPACITY') ?? '');
    this.slotCapacity = Number.isFinite(cap) && cap > 0 ? cap : DEFAULT_SLOT_CAPACITY;
  }

  private readonly logger = new Logger(BookingsService.name);
  private readonly slotCapacity: number;

  /** Guests one arrival slot takes (BOOKING_SLOT_CAPACITY). */
  get capacity(): number {
    return this.slotCapacity;
  }

  /**
   * Bookings per arrival slot for the date picker: how many parties and guests
   * already hold each morning / afternoon, as a level rather than raw counts
   * that the public could read too much into. Cancelled bookings do not count.
   */
  async availability(from: string, days: number): Promise<AvailabilityDay[]> {
    const n = Math.min(Math.max(1, days), AVAILABILITY_MAX_DAYS);
    const to = addDays(from, n - 1);
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

    const byDate = new Map<string, AvailabilityDay>();
    const empty = (): SlotLoad => ({ bookings: 0, guests: 0, level: 'quiet' });
    for (let i = 0; i < n; i++) {
      const date = addDays(from, i);
      byDate.set(date, { date, morning: empty(), afternoon: empty() });
    }
    for (const r of rows) {
      const day = byDate.get(dateOf(r.date));
      if (!day || (r.slot !== 'morning' && r.slot !== 'afternoon')) continue;
      const guests = Number(r.guests) || 0;
      day[r.slot] = { bookings: Number(r.bookings) || 0, guests, level: busyLevel(guests, this.slotCapacity) };
    }
    return [...byDate.values()];
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

    for (let attempt = 0; attempt < REF_MAX_TRIES; attempt++) {
      const refCode = this.generateRefCode();
      try {
        return await this.persist(dto, priced, refCode, email, phone, visitDate, adjustment);
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
  ): Promise<BookingResponse> {
    const { saved, lines } = await this.dataSource.transaction(async (manager) => {
      // The slot must really have room: the picker's level is only advisory.
      await reserveSlotPlaces(manager, visitDate, dto.slot, dto.adults + dto.kids, this.slotCapacity);
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
