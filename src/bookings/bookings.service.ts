import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  Optional,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import { ChatGateway } from '../chat/chat.gateway';
import { settingsMap } from '../common/collections';
import { parkToday } from '../common/park-time';
import { Booking, BookingDraft, BookingLine, Experience, PriceListEntry, Product, Setting, SlotHold, isProductId, productKeyOf } from '../entities';
import { HOLD_MINUTES, parseCalendar, reservePlaces, type Calendar, type ExperienceInfo, type SlotKey } from './capacity';
import {
  addBookedLoads, addHeldGuests, applyActivityLevels, applySessionLevels, applySlotLevels, availabilityWindow, emptyDays, tallyTaken,
  type AvailabilityDay,
} from './availability';
import {
  bookingResponse, lineRecords, newBookingRecord,
  type BookingAdjustment, type BookingContact, type BookingResponse, type Checkout,
} from './booking-records';
import { BookingNotifierService } from '../notifications/booking-notifier.service';
import { GuestMessagingService } from '../notifications/guest-messaging.service';
import { TicketService } from '../tickets/ticket.service';
import { CouponsService } from '../coupons/coupons.service';
import { PaymentsService } from '../payments/payments.service';
import { toBookingRow } from '../staff/bookings/booking-row';
import { CreateBookingDto } from './dto/create-booking.dto';
import { adjustmentAmount, computeBooking, entrySettings, groupDepositAmount, PricedBooking } from './pricing';
import { assertAgeMinimums, assertLinesFitParty, type LineInfo } from './party-rules';

export { AVAILABILITY_MAX_DAYS, busyLevel, type AvailabilityDay, type BusyLevel, type SlotLoad } from './availability';
export type { BookingResponse } from './booking-records';

const REF_MAX_TRIES = 20;
const PG_UNIQUE_VIOLATION = '23505';
/** A saved booking page stays retrievable this long. */
const DRAFT_DAYS = 14;
const DRAFT_MAX_CHARS = 16_384;
const DAY_MS = 86_400_000;

/** An item of a hold: what the guest picked so far. */
export interface HoldItem { id: string; adults?: number; kids?: number; units?: number; time?: string }
export interface HoldRequest { visitDate: string; slot: SlotKey; adults: number; kids: number; infants?: number; items: HoldItem[]; holdId?: string }

/** Everything create() works out before it writes, handed to each write attempt. */
interface PreparedBooking {
  dto: CreateBookingDto;
  priced: PricedBooking;
  contact: BookingContact;
  adjustment: BookingAdjustment | null;
  cal: Calendar;
  experienceInfo: Map<string, ExperienceInfo>;
  settings: Map<string, string>;
}

/** Grouped "taken" rows of the capacity queries. */
interface SessionTakenRow { date: string; id: string; t: string; pp: number; u: number }
interface ActivityTakenRow { date: string; slot: string; id: string; pp: number; u: number }

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
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(BookingDraft)
    private readonly draftRepo: Repository<BookingDraft>,
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
    return parseCalendar(settingsMap(settings), this.envSlotCapacity);
  }

  /** name + price mode per experience, for the capacity check's wording and units. */
  async experienceInfo(): Promise<Map<string, ExperienceInfo>> {
    const rows = await this.experienceRepo.find();
    return new Map(rows.map((e) => [e.id, { name: e.name, priceMode: e.priceMode, ageLabel: e.ageLabel }]));
  }

  /** Name and age label of every experience and product, for the party rules' messages. */
  async lineInfo(): Promise<(id: string) => LineInfo | undefined> {
    const [exps, products] = await Promise.all([this.experienceRepo.find(), this.productRepo.find()]);
    const byExp = new Map(exps.map((e) => [e.id, { name: e.name, ageLabel: e.ageLabel }]));
    const byProduct = new Map(products.map((p) => [p.key, { name: p.name }]));
    return (id: string) => (isProductId(id) ? byProduct.get(productKeyOf(id)) : byExp.get(id));
  }

  /** The line rules every path applies: no line above the party, no child below a 12+ minimum. */
  async checkParty(items: { id: string; adults?: number; kids?: number }[], party: { adults: number; kids: number; infants?: number }): Promise<void> {
    const info = await this.lineInfo();
    assertLinesFitParty(items, party, info);
    assertAgeMinimums(items, info);
  }

  /**
   * Bookings per arrival slot for the date picker: how many parties and guests
   * already hold each morning / afternoon, as a level rather than raw counts
   * that the public could read too much into. Cancelled bookings do not count.
   */
  async availability(fromDay: string, requestedDays: number): Promise<AvailabilityDay[]> {
    const { from, to, days } = availabilityWindow(fromDay, requestedDays);
    const cal = await this.calendar();
    const rows = await this.bookingRepo
      .createQueryBuilder('b')
      .select('b.visitDate', 'date')
      .addSelect('b.slot', 'slot')
      .addSelect('COUNT(*)', 'bookings')
      .addSelect('COALESCE(SUM(b.adults + b.kids + b.infants), 0)', 'guests')
      .where('b.visitDate BETWEEN :from AND :to', { from, to })
      .andWhere('b.status NOT IN (:...gone)', { gone: ['cancelled', 'postponed'] })
      .groupBy('b.visitDate')
      .addGroupBy('b.slot')
      .getRawMany<{ date: string | Date; slot: string; bookings: string; guests: string }>();
    // places held mid-form count like bookings until they expire
    const held = await this.holdRepo
      .createQueryBuilder('h')
      .select('h.visitDate', 'date')
      .addSelect('h.slot', 'slot')
      .addSelect('COALESCE(SUM(h.adults + h.kids + h.infants), 0)', 'guests')
      .where('h.visitDate BETWEEN :from AND :to', { from, to })
      .andWhere('h.expiresAt > now()')
      .groupBy('h.visitDate')
      .addGroupBy('h.slot')
      .getRawMany<{ date: string | Date; slot: string; guests: string }>();

    const byDate = emptyDays(from, days);
    addBookedLoads(byDate, rows);
    addHeldGuests(byDate, held);
    applySlotLevels(byDate, cal);

    const capped = Object.keys(cal.activityCapacity);
    if (capped.length > 0) {
      const taken = await this.activityTakenInRange(from, to, capped);
      applyActivityLevels(byDate, cal, await this.experienceInfo(), taken);
    }
    const sessioned = Object.keys(cal.sessions);
    if (sessioned.length > 0) {
      const taken = await this.sessionTakenInRange(from, to, sessioned);
      applySessionLevels(byDate, cal, await this.experienceInfo(), taken);
    }
    return [...byDate.values()];
  }

  /** "date|experience|time|pp|u" -> guests or units already in that session (bookings + live holds). */
  private async sessionTakenInRange(from: string, to: string, ids: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const key = (r: SessionTakenRow) => `${r.date.slice(0, 10)}|${r.id}|${r.t}`;
    const booked = await this.dataSource.query<SessionTakenRow[]>(
      `SELECT b.visit_date::text AS date, l.experience_id AS id, l.session_time AS t, COALESCE(SUM(l.adults + l.kids), 0)::int AS pp, COALESCE(SUM(l.units), 0)::int AS u
       FROM booking_lines l JOIN bookings b ON b.id = l.booking_id
       WHERE b.visit_date BETWEEN $1 AND $2 AND b.status NOT IN ('cancelled','postponed') AND l.experience_id = ANY($3) AND l.session_time IS NOT NULL
       GROUP BY b.visit_date, l.experience_id, l.session_time`,
      [from, to, ids],
    );
    tallyTaken(out, booked, key);
    const held = await this.dataSource.query<SessionTakenRow[]>(
      `SELECT h.visit_date::text AS date, i->>'id' AS id, i->>'time' AS t,
              COALESCE(SUM(COALESCE((i->>'adults')::int, 0) + COALESCE((i->>'kids')::int, 0)), 0)::int AS pp,
              COALESCE(SUM(COALESCE((i->>'units')::int, 0)), 0)::int AS u
       FROM slot_holds h, jsonb_array_elements(h.items) i
       WHERE h.visit_date BETWEEN $1 AND $2 AND h.expires_at > now() AND i->>'id' = ANY($3) AND i->>'time' IS NOT NULL
       GROUP BY h.visit_date, i->>'id', i->>'time'`,
      [from, to, ids],
    );
    tallyTaken(out, held, key);
    return out;
  }

  /** "date|slot|experience|pp|u" -> guests or units already taken (bookings + live holds). */
  private async activityTakenInRange(from: string, to: string, ids: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const key = (r: ActivityTakenRow) => `${r.date.slice(0, 10)}|${r.slot}|${r.id}`;
    const booked = await this.dataSource.query<ActivityTakenRow[]>(
      `SELECT b.visit_date::text AS date, b.slot, l.experience_id AS id, COALESCE(SUM(l.adults + l.kids), 0)::int AS pp, COALESCE(SUM(l.units), 0)::int AS u
       FROM booking_lines l JOIN bookings b ON b.id = l.booking_id
       WHERE b.visit_date BETWEEN $1 AND $2 AND b.status NOT IN ('cancelled','postponed') AND l.experience_id = ANY($3)
       GROUP BY b.visit_date, b.slot, l.experience_id`,
      [from, to, ids],
    );
    tallyTaken(out, booked, key);
    const held = await this.dataSource.query<ActivityTakenRow[]>(
      `SELECT h.visit_date::text AS date, h.slot, i->>'id' AS id,
              COALESCE(SUM(COALESCE((i->>'adults')::int, 0) + COALESCE((i->>'kids')::int, 0)), 0)::int AS pp,
              COALESCE(SUM(COALESCE((i->>'units')::int, 0)), 0)::int AS u
       FROM slot_holds h, jsonb_array_elements(h.items) i
       WHERE h.visit_date BETWEEN $1 AND $2 AND h.expires_at > now() AND i->>'id' = ANY($3)
       GROUP BY h.visit_date, h.slot, i->>'id'`,
      [from, to, ids],
    );
    tallyTaken(out, held, key);
    return out;
  }

  // ------------------------------------------------------------------ holds

  /**
   * Holds the party's places for HOLD_MINUTES while the guest types their
   * details. Checked like a booking (closures, slot and activity capacity);
   * an earlier hold of the same guest is replaced.
   */
  async hold(input: HoldRequest): Promise<{ holdId: string; expiresAt: string }> {
    await this.checkParty(input.items, input);
    const [cal, experiences] = await Promise.all([this.calendar(), this.experienceInfo()]);
    const visitDate = input.visitDate.slice(0, 10);
    return this.dataSource.transaction(async (manager) => {
      if (input.holdId) await manager.delete(SlotHold, { id: input.holdId });
      await reservePlaces(manager, { ...input, visitDate }, cal, experiences);
      const saved = await manager.save(SlotHold, manager.create(SlotHold, {
        visitDate, slot: input.slot, adults: input.adults, kids: input.kids, infants: input.infants ?? 0, items: input.items.map((i) => ({ id: i.id, adults: i.adults ?? 0, kids: i.kids ?? 0, units: i.units ?? 0, ...(i.time ? { time: i.time } : {}) })),
        expiresAt: new Date(Date.now() + HOLD_MINUTES * 60_000),
      }));
      return { holdId: saved.id, expiresAt: saved.expiresAt.toISOString() };
    });
  }

  async releaseHold(holdId: string): Promise<void> {
    await this.holdRepo.delete({ id: holdId });
  }

  // ------------------------------------------------------------------ drafts

  /**
   * Keeps what the guest had on the booking page for 14 days and e-mails them
   * a link that brings it all back (cart, party, date, slot, details).
   */
  async saveDraft(email: string, payload: Record<string, unknown>): Promise<{ id: string; sent: boolean }> {
    if (JSON.stringify(payload).length > DRAFT_MAX_CHARS) throw new BadRequestException('The saved booking is too large');
    const d = await this.draftRepo.save(this.draftRepo.create({ email, payload, expiresAt: new Date(Date.now() + DRAFT_DAYS * DAY_MS) }));
    const link = `${this.tickets?.siteUrl ?? ''}/booking?draft=${d.id}`;
    const sent = this.notifier?.enabled
      ? await this.notifier.mail.send({
          to: email,
          subject: 'Your VALLÉ day, saved',
          text: `Hi,\n\nYour booking at VALLÉ Advenature Park is saved, not booked yet. Pick it up where you left off, any time in the next 14 days:\n\n${link}\n\nNothing is reserved until you confirm on that page. Questions? Call +230 660 44 77.\n\nVALLÉ Advenature Park`,
        })
      : false;
    return { id: d.id, sent };
  }

  async readDraft(id: string): Promise<Record<string, unknown>> {
    const d = await this.draftRepo.findOne({ where: { id } });
    if (!d || d.expiresAt.getTime() < Date.now()) throw new NotFoundException('This saved booking has expired');
    return d.payload;
  }

  // ------------------------------------------------------------------ create

  async create(dto: CreateBookingDto): Promise<BookingResponse> {
    // A retry (double tap, lost response) carries the key of the attempt that already succeeded.
    const done = await this.findByIdempotencyKey(dto.idempotencyKey);
    if (done) return this.responseFor(done);

    const contact = this.validateRequest(dto);
    await this.checkParty(dto.items, { adults: dto.adults, kids: dto.kids, infants: dto.infants ?? 0 });
    const { priced, settings } = await this.price(dto, contact.visitDate);

    // A promo / partner code: validated now, counted inside the booking transaction.
    const offer = dto.couponCode && this.coupons ? await this.coupons.resolve(dto.couponCode) : null;
    const adjustment: BookingAdjustment | null = offer
      ? { kind: offer.kind, value: offer.value, amount: adjustmentAmount(offer.kind, offer.value, priced), note: offer.note, code: offer.code }
      : null;

    const [cal, experienceInfo] = await Promise.all([this.calendar(), this.experienceInfo()]);
    const prepared: PreparedBooking = { dto, priced, contact, adjustment, cal, experienceInfo, settings };

    for (let attempt = 0; attempt < REF_MAX_TRIES; attempt++) {
      try {
        return await this.persist(prepared, this.generateRefCode());
      } catch (err) {
        if (this.isUniqueViolation(err, 'idempotency')) {
          // the twin request got there first: hand back what it wrote
          const twin = await this.findByIdempotencyKey(dto.idempotencyKey);
          if (twin) return this.responseFor(twin);
        }
        if (this.isUniqueViolation(err)) continue; // ref collision, retry
        throw err;
      }
    }
    throw new ConflictException(
      'Could not allocate a unique booking reference, please try again',
    );
  }

  // ------------------------------------------------------------------ helpers

  private async findByIdempotencyKey(key: string | undefined): Promise<Booking | null> {
    return key ? this.bookingRepo.findOne({ where: { idempotencyKey: key } }) : null;
  }

  /**
   * The rules a request must meet before anything is priced: a way to reach
   * the guest, a party the booking type allows, a visit date not in the past.
   */
  private validateRequest(dto: CreateBookingDto): BookingContact {
    const email = (dto.email ?? '').trim();
    const phone = (dto.phone ?? '').trim();
    if (!email && !phone) {
      throw new BadRequestException(
        'Provide at least an email address or a phone number',
      );
    }

    // Ordinary bookings keep the 12-person cap; a group says who it is and gets a bigger party.
    const party = dto.adults + dto.kids + (dto.infants ?? 0);
    if (!dto.group && (dto.adults > 12 || dto.kids > 12 || (dto.infants ?? 0) > 12)) throw new BadRequestException('Parties over 12 book as a group (school, company or club)');
    if (dto.group && party < 10) throw new BadRequestException('A group booking is for 10 people or more');
    if (dto.group && (dto.group.participants?.length ?? 0) > party) throw new BadRequestException('More participants listed than people in the party');

    const visitDate = dto.visitDate.slice(0, 10);
    // "Today" is whatever day it is at the park, not on the server.
    if (visitDate < parkToday()) {
      throw new BadRequestException('visitDate cannot be in the past');
    }
    return { email, phone, visitDate };
  }

  /** Prices the request from the database rows, never from anything the client sent. */
  private async price(dto: CreateBookingDto, visitDate: string): Promise<{ priced: PricedBooking; settings: Map<string, string> }> {
    const [experiences, settingRows, priceRows, products] = await Promise.all([
      this.experienceRepo.find(),
      this.settingRepo.find(),
      this.priceRepo.find(),
      this.productRepo.find(),
    ]);
    const settings = settingsMap(settingRows);
    const priced = computeBooking(
      experiences,
      entrySettings(settings),
      { adults: dto.adults, kids: dto.kids, infants: dto.infants ?? 0, rate: dto.rate, items: dto.items, visitDate },
      priceRows,
      products,
    );
    return { priced, settings };
  }

  private async persist(prepared: PreparedBooking, refCode: string): Promise<BookingResponse> {
    const { dto, priced } = prepared;
    const { saved, lines } = await this.dataSource.transaction((manager) => this.write(manager, prepared, refCode));

    // After the commit, so the desk is never told about a booking that rolled back.
    void this.notifyStaff(saved, lines);
    const checkout = await this.openCheckoutOrSendTicket(dto, saved, lines);

    return bookingResponse(
      saved,
      priced.lines,
      { ticketUrl: this.tickets?.ticketUrl(saved.refCode, saved.lang), qrUrl: this.tickets?.qrUrl(saved.refCode) },
      checkout,
      prepared.settings.get('group_bank_details') ?? '',
    );
  }

  /** The booking, its coupon use and its lines, inside the caller's transaction. */
  private async write(manager: EntityManager, prepared: PreparedBooking, refCode: string): Promise<{ saved: Booking; lines: BookingLine[] }> {
    const { dto, priced, contact, adjustment } = prepared;
    // The slot, the day and every capped activity must really have room: the picker is only advisory.
    await reservePlaces(
      manager,
      { visitDate: contact.visitDate, slot: dto.slot, adults: dto.adults, kids: dto.kids, infants: dto.infants ?? 0, items: dto.items, holdId: dto.holdId },
      prepared.cal,
      prepared.experienceInfo,
    );
    if (dto.holdId) await manager.delete(SlotHold, { id: dto.holdId });
    const booking = manager.create(Booking, newBookingRecord(dto, priced, refCode, contact, adjustment));
    if (dto.group) booking.depositAmount = groupDepositAmount(booking.total, prepared.settings.get('group_deposit_percent'));
    const saved = await manager.save(booking);
    if (adjustment && this.coupons) await this.coupons.consume(adjustment.code, manager);

    const lines = lineRecords(saved.id, priced.lines).map((l) => manager.create(BookingLine, l));
    await manager.save(lines);
    return { saved, lines };
  }

  /**
   * "Pay online now" with a gateway configured: open the checkout and hold the
   * ticket until the money arrives (PaymentsService sends it on the webhook, or
   * as pay-on-arrival once the checkout is abandoned). Without a gateway the
   * choice means nothing and the booking is a pay-on-arrival one.
   */
  private async openCheckoutOrSendTicket(dto: CreateBookingDto, saved: Booking, lines: BookingLine[]): Promise<Checkout | null> {
    let checkout: Checkout | null = null;
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
    return checkout;
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

  /** 'VAL-' + 4 random digits (1000..9999) + '-26' */
  private generateRefCode(): string {
    const digits = 1000 + Math.floor(Math.random() * 9000);
    return `VAL-${digits}-26`;
  }

  private isUniqueViolation(err: unknown, constraintContains?: string): boolean {
    if (!(err instanceof QueryFailedError)) return false;
    const drv = (err as QueryFailedError & { driverError?: { code?: string; constraint?: string } }).driverError;
    if (drv?.code !== PG_UNIQUE_VIOLATION) return false;
    return constraintContains ? (drv.constraint ?? '').includes(constraintContains) : true;
  }

  /** The create() response for a booking already written (a retried attempt). */
  private async responseFor(b: Booking): Promise<BookingResponse> {
    const lines = await this.lineRepo.find({ where: { bookingId: b.id }, order: { sortOrder: 'ASC' } });
    const bank = b.depositAmount ? (await this.settingRepo.findOne({ where: { key: 'group_bank_details' } }))?.value ?? '' : '';
    return bookingResponse(b, lines, { ticketUrl: this.tickets?.ticketUrl(b.refCode, b.lang), qrUrl: this.tickets?.qrUrl(b.refCode) }, null, bank);
  }
}
