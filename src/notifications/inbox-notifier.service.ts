import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Booking, JobApplication, JobVacancy, Quote } from '../entities';
import { MailService } from './mail.service';

/**
 * E-mails the team about what arrives through the website's forms other than a
 * booking: group / team-building quote requests and job applications. Without
 * them these rows sat in the back office until someone opened the right tab.
 *
 *   BOOKING_NOTIFY_TO   quote requests (the sales desk). Default sales@vallepark.com
 *   HR_NOTIFY_TO        job applications. Default: the same address as above
 *
 * Like the booking alert, a mail problem never fails the request that caused it.
 */
@Injectable()
export class InboxNotifierService {
  private readonly sales: string;
  private readonly hr: string;

  constructor(private readonly mail: MailService, config: ConfigService) {
    this.sales = (config.get<string>('BOOKING_NOTIFY_TO') ?? 'sales@vallepark.com').trim();
    this.hr = (config.get<string>('HR_NOTIFY_TO') ?? this.sales).trim();
  }

  get enabled(): boolean {
    return this.mail.enabled;
  }

  renderQuote(q: Quote): { subject: string; text: string } {
    const who = q.company ? `${q.name} (${q.company})` : q.name;
    const subject = `Quote request · ${who}${q.groupSize ? ` · ${q.groupSize} people` : ''}`;
    const text = [
      `A group just asked for a quote on the website.`,
      ``,
      `Name:        ${q.name}`,
      q.company ? `Company:     ${q.company}` : '',
      `E-mail:      ${q.email}`,
      q.phone ? `Phone:       ${q.phone}` : '',
      q.groupSize ? `Group size:  ${q.groupSize}` : '',
      q.preferredDate ? `Date:        ${q.preferredDate}` : '',
      q.message ? `Message:     ${q.message}` : '',
      ``,
      `The form promises a reply within one working day.`,
      `Open it in the back office: /staff (Quotes).`,
    ].filter((l) => l !== '').join('\n');
    return { subject, text };
  }

  renderApplication(a: JobApplication, v: JobVacancy): { subject: string; text: string } {
    const subject = `New application · ${v.title} · ${a.fullName}`;
    const text = [
      `Someone applied for "${v.title}" on the website.`,
      ``,
      `Name:        ${a.fullName}`,
      `E-mail:      ${a.email}`,
      a.phone ? `Phone:       ${a.phone}` : '',
      a.yearsExperience !== null && a.yearsExperience !== undefined ? `Experience:  ${a.yearsExperience} year${a.yearsExperience === 1 ? '' : 's'}` : '',
      a.cvUrl ? `CV:          ${a.cvUrl}` : '',
      a.coverLetter ? `\n${a.coverLetter}` : '',
      ``,
      `Review it in the back office: /hr (Applicants).`,
    ].filter((l) => l !== '').join('\n');
    return { subject, text };
  }

  /** A guest changed or cancelled their own booking from the ticket page. Never throws. */
  async notifyGuestChange(b: Booking, what: string): Promise<boolean> {
    if (!this.mail.enabled) return false;
    const subject = `Booking ${b.refCode} ${what.startsWith('Cancelled') ? 'cancelled' : 'changed'} by the guest · ${b.guestName}`;
    const text = [
      `${b.guestName} used the link on their ticket.`,
      ``,
      `Reference:   ${b.refCode}`,
      `Change:      ${what}`,
      `Now:         ${String(b.visitDate).slice(0, 10)}, ${b.slot} · ${b.adults} adult${b.adults === 1 ? '' : 's'}${b.kids ? ` · ${b.kids} child${b.kids === 1 ? '' : 'ren'}` : ''} · ${b.status}`,
      `Total:       Rs ${b.total.toLocaleString('en-US')} · paid Rs ${(b.paidAmount ?? 0).toLocaleString('en-US')}`,
      (b.paidAmount ?? 0) > b.total ? `Refund due:  Rs ${((b.paidAmount ?? 0) - b.total).toLocaleString('en-US')} (use Refund online payment in the booking drawer)` : '',
      ``,
      `Open it in the back office: /staff (Bookings, search ${b.refCode}).`,
    ].filter((l) => l !== '').join('\n');
    return this.mail.send({ to: this.sales, subject, text });
  }

  /** Never throws. */
  async notifyNewQuote(q: Quote): Promise<boolean> {
    if (!this.mail.enabled) return false;
    const { subject, text } = this.renderQuote(q);
    return this.mail.send({ to: this.sales, subject, text });
  }

  /** Never throws. */
  async notifyNewApplication(a: JobApplication, v: JobVacancy): Promise<boolean> {
    if (!this.mail.enabled) return false;
    const { subject, text } = this.renderApplication(a, v);
    return this.mail.send({ to: this.hr, subject, text });
  }
}
