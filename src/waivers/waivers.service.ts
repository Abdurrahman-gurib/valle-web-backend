import { ConflictException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Booking, BookingAudit, BookingLine, Experience, Setting, Waiver } from '../entities';
import type { StaffPrincipal } from '../staff/auth/staff-auth.types';
import { TicketService } from '../tickets/ticket.service';
import { CheckInDto, SignWaiverDto } from './waiver.dto';
import {
  GateActivity,
  WAIVER_TERMS_VERSION,
  WaiverFlag,
  ageOn,
  flagsFor,
  parseAgeLabel,
  parseLimitsSetting,
} from './waiver-rules';

const dateStr = (v: string | Date): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
export const parkToday = (): string => new Date().toLocaleDateString('en-CA', { timeZone: 'Indian/Mauritius' });

/** What the guest's waiver page needs: who still has to sign, and nothing private. */
export interface WaiverPublicView {
  refCode: string;
  guestName: string;
  visitDate: string;
  slot: 'morning' | 'afternoon';
  required: number;
  signed: { participantName: string; isMinor: boolean; signedAt: string }[];
  /** false once the visit date has passed or the booking is cancelled */
  open: boolean;
  termsVersion: string;
  activities: { name: string; minAge?: number; maxAge?: number; driveMinAge?: number; maxWeightKg?: number; minWeightKg?: number; minHeightCm?: number; maxHeightCm?: number }[];
}

export interface GateWaiver {
  id: string;
  participantName: string;
  age: number;
  birthDate: string;
  heightCm: number;
  weightKg: number;
  isMinor: boolean;
  guardianName: string;
  emergencyName: string;
  emergencyPhone: string;
  medicalNotes: string;
  photoConsent: boolean;
  signedBy: string;
  signature: string;
  lang: string;
  signedAt: string;
  flags: WaiverFlag[];
}

export interface GateView {
  refCode: string;
  guestName: string;
  phone: string;
  visitDate: string;
  slot: 'morning' | 'afternoon';
  adults: number;
  kids: number;
  status: string;
  payMode: string;
  total: number;
  isToday: boolean;
  lines: { label: string; amount: number }[];
  activities: GateActivity[];
  required: number;
  signedCount: number;
  missing: number;
  stops: number;
  waivers: GateWaiver[];
  waiverUrl: string;
}

export interface GateDayRow {
  refCode: string;
  guestName: string;
  slot: 'morning' | 'afternoon';
  party: number;
  status: string;
  signed: number;
}

@Injectable()
export class WaiversService {
  constructor(
    private readonly tickets: TicketService,
    @InjectRepository(Waiver) private readonly waiverRepo: Repository<Waiver>,
    @InjectRepository(Booking) private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(BookingLine) private readonly lineRepo: Repository<BookingLine>,
    @InjectRepository(BookingAudit) private readonly auditRepo: Repository<BookingAudit>,
    @InjectRepository(Experience) private readonly expRepo: Repository<Experience>,
    @InjectRepository(Setting) private readonly settingRepo: Repository<Setting>,
  ) {}

  /** Everyone in the party signs: adults plus children (under-6s ride free and are not counted). */
  static required(b: Booking): number {
    return b.adults + b.kids;
  }

  private isOpen(b: Booking): boolean {
    return b.status !== 'cancelled' && dateStr(b.visitDate) >= parkToday();
  }

  /** Activities in the booking that carry limits, with ages from the catalog and weights/heights from settings. */
  async activitiesFor(bookingId: string): Promise<GateActivity[]> {
    const lines = await this.lineRepo.find({ where: { bookingId } });
    const ids = [...new Set(lines.map((l) => l.experienceId).filter((x): x is string => !!x))];
    if (!ids.length) return [];
    const [exps, setting] = await Promise.all([
      this.expRepo.find({ where: { id: In(ids) } }),
      this.settingRepo.findOne({ where: { key: 'waiver_limits' } }),
    ]);
    const extra = parseLimitsSetting(setting?.value);
    return exps
      .map((e) => ({ id: e.id, name: e.name, limits: { ...parseAgeLabel(e.ageLabel), ...(extra[e.id] ?? {}) } }))
      .filter((a) => Object.keys(a.limits).length > 0);
  }

  async publicView(refCode: string, token: string | undefined): Promise<WaiverPublicView> {
    const b = await this.tickets.requireBooking(refCode, token);
    const [waivers, activities] = await Promise.all([
      this.waiverRepo.find({ where: { bookingId: b.id }, order: { signedAt: 'ASC' } }),
      this.activitiesFor(b.id),
    ]);
    return {
      refCode: b.refCode,
      guestName: b.guestName,
      visitDate: dateStr(b.visitDate),
      slot: b.slot,
      required: WaiversService.required(b),
      signed: waivers.map((w) => ({ participantName: w.participantName, isMinor: w.isMinor, signedAt: w.signedAt.toISOString() })),
      open: this.isOpen(b),
      termsVersion: WAIVER_TERMS_VERSION,
      activities: activities.map((a) => ({ name: a.name, ...a.limits })),
    };
  }

  async sign(refCode: string, token: string | undefined, dto: SignWaiverDto, meta: { ip: string; userAgent: string }): Promise<WaiverPublicView> {
    const b = await this.tickets.requireBooking(refCode, token);
    if (!this.isOpen(b)) throw new ConflictException('This booking can no longer take waivers');
    const visit = dateStr(b.visitDate);
    const age = ageOn(dto.birthDate, visit);
    if (age < 0 || age > 110) throw new BadRequestException('Please check the date of birth');
    const isMinor = age < 18;
    const guardian = (dto.guardianName ?? '').trim();
    if (isMinor && !guardian) throw new BadRequestException('A parent or guardian must sign for a participant under 18');
    const name = dto.participantName.trim().replace(/\s+/g, ' ');

    const existing = await this.waiverRepo
      .createQueryBuilder('w')
      .where('w.booking_id = :id', { id: b.id })
      .andWhere('lower(w.participant_name) = lower(:name)', { name })
      .getOne();
    if (!existing) {
      const count = await this.waiverRepo.count({ where: { bookingId: b.id } });
      if (count >= WaiversService.required(b)) {
        throw new ConflictException('Everyone in this booking has already signed. To correct a waiver, sign again under the same name.');
      }
    }
    const row = this.waiverRepo.create({
      ...(existing ? { id: existing.id } : {}),
      bookingId: b.id,
      participantName: name,
      birthDate: dto.birthDate,
      heightCm: dto.heightCm,
      weightKg: dto.weightKg,
      isMinor,
      guardianName: isMinor ? guardian : '',
      emergencyName: dto.emergencyName.trim(),
      emergencyPhone: dto.emergencyPhone.trim(),
      medicalNotes: (dto.medicalNotes ?? '').trim(),
      declarations: { risks: true, health: true, sober: true, rules: true, data: true },
      photoConsent: !!dto.photoConsent,
      signaturePng: dto.signature,
      signedBy: isMinor ? guardian : name,
      lang: dto.lang ?? 'en',
      termsVersion: WAIVER_TERMS_VERSION,
      ip: meta.ip.slice(0, 64),
      userAgent: meta.userAgent.slice(0, 300),
      signedAt: new Date(),
    });
    await this.waiverRepo.save(row);
    return this.publicView(refCode, token);
  }

  /** Signed / required for a booking (ticket page, back office list). */
  async counts(b: Booking): Promise<{ signed: number; required: number }> {
    return { signed: await this.waiverRepo.count({ where: { bookingId: b.id } }), required: WaiversService.required(b) };
  }

  // ---------------------------------------------------------------- gate

  async gateView(refCode: string): Promise<GateView> {
    const b = await this.bookingRepo.findOne({ where: { refCode: refCode.toUpperCase() } });
    if (!b) throw new NotFoundException(`No booking ${refCode}`);
    const visit = dateStr(b.visitDate);
    const [lines, waivers, activities] = await Promise.all([
      this.lineRepo.find({ where: { bookingId: b.id }, order: { sortOrder: 'ASC' } }),
      this.waiverRepo.find({ where: { bookingId: b.id }, order: { signedAt: 'ASC' } }),
      this.activitiesFor(b.id),
    ]);
    const rows: GateWaiver[] = waivers.map((w) => ({
      id: w.id,
      participantName: w.participantName,
      age: ageOn(dateStr(w.birthDate), visit),
      birthDate: dateStr(w.birthDate),
      heightCm: w.heightCm,
      weightKg: w.weightKg,
      isMinor: w.isMinor,
      guardianName: w.guardianName,
      emergencyName: w.emergencyName,
      emergencyPhone: w.emergencyPhone,
      medicalNotes: w.medicalNotes,
      photoConsent: w.photoConsent,
      signedBy: w.signedBy,
      signature: w.signaturePng,
      lang: w.lang,
      signedAt: w.signedAt.toISOString(),
      flags: flagsFor({ birthDate: dateStr(w.birthDate), heightCm: w.heightCm, weightKg: w.weightKg }, visit, activities),
    }));
    const required = WaiversService.required(b);
    return {
      refCode: b.refCode,
      guestName: b.guestName,
      phone: b.phone,
      visitDate: visit,
      slot: b.slot,
      adults: b.adults,
      kids: b.kids,
      status: b.status,
      payMode: b.payMode,
      total: b.total,
      isToday: visit === parkToday(),
      lines: lines.map((l) => ({ label: l.label, amount: l.amount })),
      activities,
      required,
      signedCount: rows.length,
      missing: Math.max(0, required - rows.length),
      stops: rows.reduce((n, w) => n + w.flags.filter((f) => f.level === 'stop').length, 0),
      waivers: rows,
      waiverUrl: this.tickets.waiverUrl(b.refCode),
    };
  }

  /** Arrivals for a day with their waiver progress, for the gate list. */
  async gateDay(date: string): Promise<GateDayRow[]> {
    const rows = await this.bookingRepo
      .createQueryBuilder('b')
      .leftJoin(Waiver, 'w', 'w.booking_id = b.id')
      .select(['b.ref_code AS "refCode"', 'b.guest_name AS "guestName"', 'b.slot AS slot', 'b.adults + b.kids AS party', 'b.status AS status', 'COUNT(w.id)::int AS signed'])
      .where('b.visit_date = :date', { date })
      .andWhere('b.status <> :cancelled', { cancelled: 'cancelled' })
      .groupBy('b.id')
      .orderBy('b.slot', 'DESC')
      .addOrderBy('b.guest_name', 'ASC')
      .getRawMany<GateDayRow>();
    return rows.map((r) => ({ ...r, party: Number(r.party), signed: Number(r.signed) }));
  }

  async checkIn(refCode: string, dto: CheckInDto, staff: StaffPrincipal): Promise<GateView> {
    const view = await this.gateView(refCode);
    if (view.status === 'cancelled') throw new ConflictException('This booking is cancelled');
    if (view.status === 'arrived') return view;
    const blocked = view.missing > 0 || view.stops > 0;
    if (blocked && !dto.override) {
      throw new ConflictException(
        view.missing > 0
          ? `${view.missing} of ${view.required} waivers are not signed yet`
          : 'A signed waiver does not meet an activity limit',
      );
    }
    const b = await this.bookingRepo.findOneOrFail({ where: { refCode: view.refCode } });
    b.status = 'arrived';
    b.updatedAt = new Date();
    b.updatedBy = staff.id;
    await this.bookingRepo.save(b);
    await this.auditRepo.save(
      this.auditRepo.create({
        bookingId: b.id,
        staffId: staff.id,
        staffEmail: staff.email,
        action: 'status',
        changes: {
          status: { from: view.status, to: 'arrived' },
          waivers: { from: null, to: `${view.signedCount}/${view.required} signed` },
          ...(blocked ? { gateOverride: { from: null, to: (dto.reason ?? '').trim() || 'checked in with missing or flagged waivers' } } : {}),
        },
      }),
    );
    return this.gateView(view.refCode);
  }
}
