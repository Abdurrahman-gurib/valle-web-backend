import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Booking, BookingLine } from '../entities';

/**
 * E-mails the reservations desk about every new booking.
 *
 * Configured with three variables on the api service:
 *   SMTP_URL             smtps://user:password@smtp.example.com:465 (or smtp://...:587)
 *   BOOKING_NOTIFY_TO    recipient(s), comma separated. Default sales@vallepark.com
 *   MAIL_FROM            sender. Default "VALLÉ bookings <no-reply@vallepark.com>"
 *
 * Without SMTP_URL nothing is sent and a warning is logged once, so the
 * booking itself is never blocked by mail: the dashboard is told over the
 * staff socket regardless (see ChatGateway.announceBooking).
 */
@Injectable()
export class BookingNotifierService {
  private readonly logger = new Logger(BookingNotifierService.name);
  private readonly transporter: Transporter | null;
  private readonly to: string;
  private readonly from: string;

  constructor(config: ConfigService) {
    const url = (config.get<string>('SMTP_URL') ?? '').trim();
    this.to = (config.get<string>('BOOKING_NOTIFY_TO') ?? 'sales@vallepark.com').trim();
    this.from = (config.get<string>('MAIL_FROM') ?? 'VALLÉ bookings <no-reply@vallepark.com>').trim();
    if (url === 'json') {
      // Test transport: renders the message without sending it.
      this.transporter = nodemailer.createTransport({ jsonTransport: true });
    } else if (url) {
      this.transporter = nodemailer.createTransport(url);
    } else {
      this.transporter = null;
      this.logger.warn('SMTP_URL is not set: new-booking e-mails are disabled (the staff dashboard is still notified live)');
    }
  }

  get enabled(): boolean {
    return this.transporter !== null;
  }

  /** Builds the message; exported for tests and for the send below. */
  render(booking: Booking, lines: BookingLine[]): { subject: string; text: string } {
    const party = `${booking.adults} adult${booking.adults === 1 ? '' : 's'}` + (booking.kids ? ` · ${booking.kids} child${booking.kids === 1 ? '' : 'ren'}` : '');
    const rs = (n: number) => 'Rs ' + n.toLocaleString('en-US');
    const items = lines.map((l) => `  - ${l.label}: ${rs(l.amount)}`).join('\n');
    const subject = `New booking ${booking.refCode} · ${booking.visitDate} ${booking.slot} · ${booking.guestName}`;
    const text = [
      `A guest just booked on the website.`,
      ``,
      `Reference:   ${booking.refCode}`,
      `Visit:       ${booking.visitDate}, ${booking.slot} arrival`,
      `Guest:       ${booking.guestName}${booking.nationality ? ' (' + booking.nationality + ')' : ''}`,
      `Contact:     ${[booking.email, booking.phone].filter(Boolean).join(' · ') || '-'}`,
      `Party:       ${party} · ${booking.rate === 'nr' ? 'visitor' : 'resident'} rate`,
      `Payment:     ${booking.payMode === 'online' ? 'paid online' : 'pays on arrival'}`,
      ``,
      `Park entry:  ${rs(booking.entryAmount)}`,
      items ? `Experiences:\n${items}` : `Experiences: none (entry only)`,
      booking.discount ? `Discount:    -${rs(booking.discount)}` : '',
      `Total:       ${rs(booking.total)}`,
      ``,
      `Open it in the back office: /staff (Bookings, search ${booking.refCode}).`,
    ].filter((l) => l !== '').join('\n');
    return { subject, text };
  }

  /** Never throws: a mail problem is logged, the booking stands. */
  async notifyNewBooking(booking: Booking, lines: BookingLine[]): Promise<boolean> {
    if (!this.transporter) return false;
    const { subject, text } = this.render(booking, lines);
    try {
      await this.transporter.sendMail({ from: this.from, to: this.to, subject, text });
      return true;
    } catch (e) {
      this.logger.error(`Could not e-mail booking ${booking.refCode} to ${this.to}: ${(e as Error).message}`);
      return false;
    }
  }
}
