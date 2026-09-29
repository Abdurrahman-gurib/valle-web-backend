import { createHmac, timingSafeEqual } from 'node:crypto';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import QRCode from 'qrcode';
import { Booking, BookingLine } from '../entities';
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
  lines: { label: string; amount: number }[];
  ticketUrl: string;
  qrUrl: string;
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
  private readonly siteUrl: string;
  private readonly apiUrl: string;

  constructor(
    config: ConfigService,
    @InjectRepository(Booking) private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(BookingLine) private readonly lineRepo: Repository<BookingLine>,
  ) {
    this.secret = resolveJwtSecret(config);
    this.siteUrl = (config.get<string>('SITE_URL') ?? 'https://vallepark.com').trim().replace(/\/+$/, '');
    this.apiUrl = this.siteUrl + '/api';
  }

  token(refCode: string): string {
    return createHmac('sha256', this.secret).update('ticket:' + refCode).digest('base64url').slice(0, 24);
  }

  verify(refCode: string, token: string | undefined): boolean {
    if (!token) return false;
    const expected = Buffer.from(this.token(refCode));
    const given = Buffer.from(token);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  ticketUrl(refCode: string): string {
    return `${this.siteUrl}/ticket/${encodeURIComponent(refCode)}?t=${this.token(refCode)}`;
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
    const lines = await this.lineRepo.find({ where: { bookingId: b.id }, order: { sortOrder: 'ASC' } });
    return this.toView(b, lines);
  }

  toView(b: Booking, lines: BookingLine[]): TicketView {
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
      lines: lines.map((l) => ({ label: l.label, amount: l.amount })),
      ticketUrl: this.ticketUrl(b.refCode),
      qrUrl: this.qrUrl(b.refCode),
    };
  }
}
