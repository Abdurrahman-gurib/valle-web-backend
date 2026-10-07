import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Booking, BookingLine } from '../entities';
import { MailService } from './mail.service';

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
  private readonly to: string;

  constructor(readonly mail: MailService, config: ConfigService) {
    this.to = (config.get<string>('BOOKING_NOTIFY_TO') ?? 'sales@vallepark.com').trim();
  }

  get enabled(): boolean {
    return this.mail.enabled;
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
      `Payment:     ${(booking.paidAmount ?? 0) >= booking.total ? 'paid' : booking.payMode === 'online' ? 'chose to pay online, nothing taken yet: collect at the gate' : 'pays on arrival'}`,
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
    if (!this.mail.enabled) return false;
    const { subject, text } = this.render(booking, lines);
    return this.mail.send({ to: this.to, subject, text });
  }
}
