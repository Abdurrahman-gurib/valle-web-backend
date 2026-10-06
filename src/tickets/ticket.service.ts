import { createHmac, timingSafeEqual } from 'node:crypto';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import QRCode from 'qrcode';
import { Booking, BookingLine, Setting, Waiver } from '../entities';
import { parseWaiverActivities, waiverRequiredCount } from '../waivers/waiver-rules';
import { renderReceiptPdf } from './receipt-pdf';
import { resolveJwtSecret } from '../staff/auth/jwt.config';

/** What the guest's ticket page shows. No internal note, no money breakdown beyond the lines. */
export interface TicketView {
  refCode: string;
  guestName: string;
  visitDate: string;
  slot: 'morning' | 'afternoon';
  adults: number;
  kids: number;
  rate: string;
  payMode: string;
  status: string;
  total: number;
  lines: { label: string; amount: number; experienceId: string | null; variant: string; adults: number; kids: number; units: number }[];
  ticketUrl: string;
  qrUrl: string;
  /** Digital waiver page for the party, and how many have signed. */
  waiverUrl: string;
  waiversSigned: number;
  waiversRequired: number;
  /** money, for the guest's receipt */
  paidAmount: number;
  balance: number;
  adjustmentAmount: number;
  adjustmentNote: string;
  couponCode: string;
  receiptUrl: string;
  postponedFrom: string | null;
}

const dateStr = (v: string | Date): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

/**
 * A guest's ticket: the booking reference plus an unguessable token derived
 * from it, so the QR code and the e-mailed link open the ticket without an
 * account, and nobody can browse other guests' bookings by guessing VAL codes.
 */
@Injectable()
export class TicketService {
  private readonly secret: string;
  /** The secret before the last rotation: links signed with it still verify. */
  private readonly previousSecret: string | null;
  readonly siteUrl: string;
  private readonly apiUrl: string;

  constructor(
    config: ConfigService,
    @InjectRepository(Booking) private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(BookingLine) private readonly lineRepo: Repository<BookingLine>,
    @InjectRepository(Waiver) private readonly waiverRepo: Repository<Waiver>,
    @InjectRepository(Setting) private readonly settingRepo: Repository<Setting>,
  ) {
    // Tickets, waivers and QR links are signed with their own secret, so the staff
    // session key (JWT_SECRET) can be rotated without killing every link ever sent.
    // The fall-back to JWT_SECRET keeps links from before TICKET_SECRET existed valid.
    this.secret = config.get<string>('TICKET_SECRET')?.trim() || resolveJwtSecret(config);
    this.previousSecret = config.get<string>('TICKET_SECRET_PREVIOUS')?.trim() || null;
    this.siteUrl = (config.get<string>('SITE_URL') ?? 'https://vallepark.com').trim().replace(/\/+$/, '');
    this.apiUrl = this.siteUrl + '/api';
  }

  token(refCode: string, secret: string = this.secret): string {
    return createHmac('sha256', secret).update('ticket:' + refCode).digest('base64url').slice(0, 24);
  }

  verify(refCode: string, token: string | undefined): boolean {
    if (!token) return false;
    const given = Buffer.from(token);
    const matches = (secret: string) => {
      const expected = Buffer.from(this.token(refCode, secret));
      return expected.length === given.length && timingSafeEqual(expected, given);
    };
    // The previous secret only verifies, never signs: new links always carry the current one.
    return matches(this.secret) || (this.previousSecret !== null && matches(this.previousSecret));
  }

  ticketUrl(refCode: string): string {
    return `${this.siteUrl}/ticket/${encodeURIComponent(refCode)}?t=${this.token(refCode)}`;
  }

  /** The waiver form, opened with the same token as the ticket. */
  waiverUrl(refCode: string): string {
    return `${this.siteUrl}/waiver/${encodeURIComponent(refCode)}?t=${this.token(refCode)}`;
  }

  receiptUrl(refCode: string): string {
    return `${this.apiUrl}/tickets/${encodeURIComponent(refCode)}/receipt.pdf?t=${this.token(refCode)}`;
  }

  qrUrl(refCode: string): string {
    return `${this.apiUrl}/tickets/${encodeURIComponent(refCode)}/qr.png?t=${this.token(refCode)}`;
  }

  /** PNG of the ticket URL, so any phone camera opens the ticket and the gate app can scan it. */
  qrPng(refCode: string): Promise<Buffer> {
    return QRCode.toBuffer(this.ticketUrl(refCode), { type: 'png', width: 480, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#340057', light: '#FFFFFF' } });
  }

  async requireBooking(refCode: string, token: string | undefined): Promise<Booking> {
    if (!this.verify(refCode, token)) throw new ForbiddenException('This ticket link is not valid');
    const booking = await this.bookingRepo.findOne({ where: { refCode } });
    if (!booking) throw new NotFoundException('No such booking');
    return booking;
  }

  async view(refCode: string, token: string | undefined): Promise<TicketView> {
    const b = await this.requireBooking(refCode, token);
    const [lines, signed, setting] = await Promise.all([
      this.lineRepo.find({ where: { bookingId: b.id }, order: { sortOrder: 'ASC' } }),
      this.waiverRepo.count({ where: { bookingId: b.id } }),
      this.settingRepo.findOne({ where: { key: 'waiver_activities' } }),
    ]);
    return this.toView(b, lines, signed, waiverRequiredCount(lines, parseWaiverActivities(setting?.value), b));
  }

  /** The guest's receipt: lines, discounts, what was paid and what is left. */
  async receiptPdf(refCode: string, token: string | undefined): Promise<Buffer> {
    const b = await this.requireBooking(refCode, token);
    const lines = await this.lineRepo.find({ where: { bookingId: b.id }, order: { sortOrder: 'ASC' } });
    return renderReceiptPdf(b, lines, { siteUrl: this.siteUrl });
  }

  toView(b: Booking, lines: BookingLine[], waiversSigned = 0, waiversRequired = b.adults + b.kids): TicketView {
    return {
      refCode: b.refCode,
      guestName: b.guestName,
      visitDate: dateStr(b.visitDate),
      slot: b.slot,
      adults: b.adults,
      kids: b.kids,
      rate: b.rate,
      payMode: b.payMode,
      status: b.status,
      total: b.total,
      lines: lines.map((l) => ({ label: l.label, amount: l.amount, experienceId: l.experienceId, variant: l.variant ?? '', adults: l.adults, kids: l.kids, units: l.units })),
      ticketUrl: this.ticketUrl(b.refCode),
      qrUrl: this.qrUrl(b.refCode),
      waiverUrl: this.waiverUrl(b.refCode),
      waiversSigned,
      waiversRequired,
      paidAmount: b.paidAmount ?? 0,
      balance: Math.max(0, b.total - (b.paidAmount ?? 0)),
      adjustmentAmount: b.adjustmentAmount ?? 0,
      adjustmentNote: b.adjustmentNote ?? '',
      couponCode: b.couponCode ?? '',
      receiptUrl: this.receiptUrl(b.refCode),
      postponedFrom: b.postponedFrom ? String(b.postponedFrom).slice(0, 10) : null,
    };
  }
}
