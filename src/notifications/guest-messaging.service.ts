import { Injectable, Optional, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Booking, BookingLine } from '../entities';
import { TicketService } from '../tickets/ticket.service';
import { ParkStatusService } from '../weather/park-status.service';
import { MailService } from './mail.service';
import { WhatsAppService, type BookingMessage } from './whatsapp.service';

const PARK_TZ = 'Indian/Mauritius';
const REMINDER_HOUR = 17; // sent between 17:00 and midnight, park time, the evening before
const REMINDER_SWEEP_MS = 15 * 60 * 1000;

const rs = (n: number) => 'Rs ' + n.toLocaleString('en-US');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dateStr = (v: string | Date): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const longDate = (iso: string): string =>
  new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const slotLabel = (slot: string) => (slot === 'morning' ? 'Morning arrival, 09:00 to 12:00' : 'Afternoon arrival, 12:00 to 15:30');
const party = (b: Booking) => `${b.adults} adult${b.adults === 1 ? '' : 's'}` + (b.kids ? ` and ${b.kids} child${b.kids === 1 ? '' : 'ren'}` : '');
const addDays = (iso: string, n: number): string => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const parkNow = () => new Date(new Date().toLocaleString('en-US', { timeZone: PARK_TZ }));
const parkToday = () => new Date().toLocaleDateString('en-CA', { timeZone: PARK_TZ });

const PARK_ADDRESS = 'B102, Mare Anguilles, Chamouny, Mauritius';
const PARK_PHONE = '+230 660 44 77';
const MAPS = 'https://maps.google.com/?q=Vall%C3%A9+Advenature+Park+Chamouny';

/**
 * What the guest receives: the ticket (with QR) right after booking, by e-mail
 * and, when a WhatsApp sender is configured, by WhatsApp; and a reminder the
 * evening before the visit. Sending never blocks or fails a booking.
 */
@Injectable()
export class GuestMessagingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GuestMessagingService.name);
  private sweep: ReturnType<typeof setInterval> | null = null;
  private readonly remindersOn: boolean;

  constructor(
    private readonly mail: MailService,
    private readonly whatsapp: WhatsAppService,
    private readonly tickets: TicketService,
    @InjectRepository(Booking) private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(BookingLine) private readonly lineRepo: Repository<BookingLine>,
    config: ConfigService,
    @Optional() private readonly parkStatus?: ParkStatusService,
  ) {
    this.remindersOn = (config.get<string>('GUEST_REMINDERS') ?? '1') !== '0';
  }

  onModuleInit(): void {
    if (!this.remindersOn || process.env.NODE_ENV === 'test') return;
    this.sweep = setInterval(() => { void this.sendDueReminders(); }, REMINDER_SWEEP_MS);
    this.sweep.unref?.();
  }

  onModuleDestroy(): void {
    if (this.sweep) clearInterval(this.sweep);
  }

  // ------------------------------------------------------------------ ticket

  /** E-mail + WhatsApp the ticket; records ticket_sent_at when at least one went out. */
  async sendTicket(booking: Booking, lines?: BookingLine[]): Promise<{ email: boolean; whatsapp: boolean }> {
    const items = lines ?? (await this.lineRepo.find({ where: { bookingId: booking.id }, order: { sortOrder: 'ASC' } }));
    const [email, whatsapp] = await Promise.all([
      booking.email ? this.sendTicketEmail(booking, items) : Promise.resolve(false),
      booking.phone ? this.whatsapp.sendBooking('ticket', booking.phone, this.ticketWhatsApp(booking)) : Promise.resolve(false),
    ]);
    if (email || whatsapp) {
      await this.bookingRepo.update({ id: booking.id }, { ticketSentAt: new Date() });
    }
    this.logger.log(`Ticket ${booking.refCode}: e-mail ${email ? 'sent' : booking.email ? 'failed/off' : 'no address'}, WhatsApp ${whatsapp ? 'sent' : booking.phone ? 'failed/off' : 'no number'}`);
    return { email, whatsapp };
  }

  /** Visit line shared by the WhatsApp templates: "Friday 2 October 2026, morning arrival 09:00 to 12:00". */
  private visitLine(b: Booking): string {
    return `${longDate(dateStr(b.visitDate))}, ${slotLabel(b.slot).replace('Morning arrival', 'morning arrival').replace('Afternoon arrival', 'afternoon arrival')}`;
  }

  /**
   * What the guest still owes, from the payment actually recorded on the booking
   * (never from payMode: choosing "pay online" takes no money until a gateway exists).
   */
  private payLine(b: Booking): string {
    const paid = b.paidAmount ?? 0;
    if (paid >= b.total) return `${rs(b.total)} paid`;
    if ((b.depositAmount ?? 0) > paid) return `${rs(b.depositAmount - paid)} deposit due now, ${rs(b.total - paid)} in all`;
    if (paid > 0) return `${rs(paid)} paid, ${rs(b.total - paid)} to pay on arrival`;
    return `${rs(b.total)} to pay on arrival`;
  }

  /** Template parameters (360dialog) plus the full text (Twilio fallback) for the ticket. */
  ticketWhatsApp(b: Booking): BookingMessage {
    return {
      params: [b.guestName.split(' ')[0] || b.guestName, b.refCode, this.visitLine(b), party(b), this.payLine(b)],
      ticketPath: `${b.refCode}?t=${this.tickets.token(b.refCode)}`,
      text: this.ticketWhatsAppText(b),
    };
  }

  reminderWhatsApp(b: Booking): BookingMessage {
    return {
      params: [b.guestName.split(' ')[0] || b.guestName, this.visitLine(b), this.payLine(b)],
      ticketPath: `${b.refCode}?t=${this.tickets.token(b.refCode)}`,
      text: this.reminderText(b),
    };
  }

  ticketWhatsAppText(b: Booking): string {
    return [
      `Hi ${b.guestName.split(' ')[0]}, your VALLÉ Advenature™ Park booking is confirmed! 🎟️`,
      `Reference: ${b.refCode}`,
      `${longDate(dateStr(b.visitDate))} · ${slotLabel(b.slot)}`,
      `${party(b)} · ${this.payLine(b)}`,
      ``,
      `Your ticket with QR code: ${this.tickets.ticketUrl(b.refCode)}`,
      `Skip the paper at the gate: sign the safety waiver for everyone in your party now: ${this.tickets.waiverUrl(b.refCode)}`,
      `Show it at the gate. Directions: ${MAPS}`,
      `Questions? Reply here or call ${PARK_PHONE}.`,
    ].join('\n');
  }

  /** Subject, text and HTML of the ticket e-mail (exported for tests). */
  renderTicketEmail(b: Booking, lines: BookingLine[]): { subject: string; text: string; html: string } {
    const visit = longDate(dateStr(b.visitDate));
    const url = this.tickets.ticketUrl(b.refCode);
    const waiver = this.tickets.waiverUrl(b.refCode);
    const paidInFull = (b.paidAmount ?? 0) >= b.total;
    const pay = paidInFull ? `Paid: ${rs(b.total)}` : `${this.payLine(b).replace(/^Rs/, 'To pay on arrival: Rs').replace(' to pay on arrival', '')} (cash or card at the gate)`;
    const subject = `Your VALLÉ ticket ${b.refCode} · ${visit}`;
    const lineText = lines.map((l) => `  • ${l.label}: ${rs(l.amount)}`).join('\n');
    const text = [
      `Hi ${b.guestName},`,
      ``,
      `Your day at VALLÉ Advenature™ Park is booked. Show the QR code (attached, and at the link below) at the gate.`,
      ``,
      `Reference: ${b.refCode}`,
      `Visit: ${visit}`,
      `${slotLabel(b.slot)}`,
      `Party: ${party(b)} · ${b.rate === 'nr' ? 'visitor rate' : 'resident rate (bring an ID)'}`,
      lineText,
      `Total: ${rs(b.total)} · ${pay}`,
      ``,
      `Your ticket: ${url}`,
      ``,
      `Sign the safety waiver before you arrive (one per person, 2 minutes on your phone, it saves queuing at the gate): ${waiver}`,
      ``,
      `Getting here: ${PARK_ADDRESS}. ${MAPS}`,
      `Bring closed shoes, sunscreen, water and a change of clothes for the waterfalls. Zipline, quad and buggy have age, height and weight limits.`,
      `Free cancellation: reply to this e-mail or call ${PARK_PHONE}.`,
      ``,
      `See you in the valley!`,
      `VALLÉ Advenature™ Park · ${PARK_PHONE} · sales@vallepark.com`,
    ].join('\n');
    const lineRows = lines.map((l) => `<tr><td style="padding:6px 0;color:#340057">${esc(l.label)}</td><td style="padding:6px 0;text-align:right;font-family:monospace;color:#340057">${rs(l.amount)}</td></tr>`).join('');
    const html = `<!doctype html><html><body style="margin:0;background:#F7F3FF;font-family:Arial,Helvetica,sans-serif;color:#340057">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div style="background:#340057;color:#FFFFFF;border-radius:18px 18px 0 0;padding:22px 24px">
    <div style="font-size:11px;letter-spacing:.16em;opacity:.7">VALLÉ ADVENATURE™ PARK</div>
    <div style="font-size:26px;font-weight:900;font-style:italic;margin-top:6px">Your ticket is ready</div>
  </div>
  <div style="height:8px;background:repeating-linear-gradient(-45deg,#33FF74 0 12px,#340057 12px 24px)"></div>
  <div style="background:#FFFFFF;padding:24px;border-radius:0 0 18px 18px">
    <p style="margin:0 0 14px;font-size:15px;line-height:1.5">Hi ${esc(b.guestName)}, your day in the valley is booked. Show this QR code at the gate:</p>
    <div style="text-align:center;margin:10px 0 18px"><img src="cid:ticket-qr" alt="Ticket QR code ${esc(b.refCode)}" width="220" height="220" style="display:inline-block;border:1px solid #EBE2FF;border-radius:12px;padding:8px;background:#FFFFFF"></div>
    <div style="text-align:center;font-family:monospace;font-size:24px;font-weight:700;color:#FF3358;letter-spacing:.06em">${esc(b.refCode)}</div>
    <table style="width:100%;border-collapse:collapse;margin-top:18px;font-size:14px">
      <tr><td style="padding:6px 0;color:#7333FF;font-size:11px;letter-spacing:.12em">VISIT</td><td style="padding:6px 0;text-align:right">${esc(visit)}</td></tr>
      <tr><td style="padding:6px 0;color:#7333FF;font-size:11px;letter-spacing:.12em">ARRIVAL</td><td style="padding:6px 0;text-align:right">${esc(slotLabel(b.slot))}</td></tr>
      <tr><td style="padding:6px 0;color:#7333FF;font-size:11px;letter-spacing:.12em">PARTY</td><td style="padding:6px 0;text-align:right">${esc(party(b))} · ${b.rate === 'nr' ? 'visitor rate' : 'resident rate, bring an ID'}</td></tr>
    </table>
    <hr style="border:0;border-top:1px dashed #D9CCF2;margin:14px 0">
    <table style="width:100%;border-collapse:collapse;font-size:14px">${lineRows}
      <tr><td style="padding:10px 0 0;font-weight:800;font-size:16px">Total</td><td style="padding:10px 0 0;text-align:right;font-weight:800;font-size:16px;font-family:monospace">${rs(b.total)}</td></tr>
    </table>
    <p style="margin:8px 0 0;font-size:13px;color:#7333FF;font-weight:700">${esc(pay)}</p>
    <p style="text-align:center;margin:22px 0 6px"><a href="${url}" style="background:#FF3358;color:#FFFFFF;text-decoration:none;font-weight:700;padding:13px 24px;border-radius:999px;display:inline-block">Open my ticket</a></p>
    <p style="text-align:center;margin:0;font-size:12px;color:#7A6A93">Save it to your phone, or add it to WhatsApp from the ticket page.</p>
    <div style="margin:20px 0 0;background:#FFFDE0;border:1.5px solid #FFE94D;border-radius:14px;padding:16px 18px">
      <p style="margin:0 0 6px;font-size:14px;font-weight:800">Skip the queue: sign your waivers now</p>
      <p style="margin:0 0 12px;font-size:13px;line-height:1.5">Ziplines, quads and buggies need a signed safety waiver for every participant. Fill it in on your phone before you arrive, one per person, and walk straight past the paperwork at the gate.</p>
      <a href="${waiver}" style="background:#340057;color:#FFFFFF;text-decoration:none;font-weight:700;padding:10px 20px;border-radius:999px;display:inline-block;font-size:14px">Sign the waivers</a>
    </div>
    <hr style="border:0;border-top:1px dashed #D9CCF2;margin:20px 0">
    <p style="margin:0 0 8px;font-size:13px;line-height:1.55"><strong>Getting here.</strong> ${esc(PARK_ADDRESS)}. <a href="${MAPS}" style="color:#7333FF">Open in Google Maps</a>. Free parking at the gate.</p>
    <p style="margin:0 0 8px;font-size:13px;line-height:1.55"><strong>Bring.</strong> Closed shoes, sunscreen, water and a change of clothes for the waterfalls. Zipline, quad and buggy have age, height and weight limits.</p>
    <p style="margin:0;font-size:13px;line-height:1.55"><strong>Change of plans?</strong> Cancellation is free: reply to this e-mail or call ${esc(PARK_PHONE)}.</p>
  </div>
  <p style="text-align:center;font-size:11px;color:#7A6A93;margin:16px 0 0">VALLÉ Advenature™ Park · ${esc(PARK_ADDRESS)} · ${esc(PARK_PHONE)} · sales@vallepark.com</p>
</div></body></html>`;
    return { subject, text, html };
  }

  private async sendTicketEmail(b: Booking, lines: BookingLine[]): Promise<boolean> {
    if (!this.mail.enabled) return false;
    const { subject, text, html } = this.renderTicketEmail(b, lines);
    const png = await this.tickets.qrPng(b.refCode);
    return this.mail.send({
      to: b.email,
      subject,
      text,
      html,
      attachments: [{ filename: `valle-ticket-${b.refCode}.png`, content: png, contentType: 'image/png', cid: 'ticket-qr' }],
    });
  }

  // ---------------------------------------------------------------- waiver link

  /** Text of the "please sign your waivers" message (exported for tests). */
  waiverLinkText(b: Booking): string {
    return [
      `Hi ${b.guestName.split(' ')[0] || b.guestName}, one thing before your visit to VALLÉ Advenature™ Park on ${longDate(dateStr(b.visitDate))}:`,
      `each participant needs a signed safety waiver (Disclaimer Form). Sign it on your phone now, one per person, and skip the paperwork at the gate:`,
      this.tickets.waiverUrl(b.refCode),
      ``,
      `Booking ${b.refCode} · questions? Reply here or call ${PARK_PHONE}.`,
    ].join('\n');
  }

  /** Staff re-sends the waiver link: e-mail always, WhatsApp when the 24-hour window allows a plain message. */
  async sendWaiverLink(b: Booking): Promise<{ email: boolean; whatsapp: boolean }> {
    const text = this.waiverLinkText(b);
    const url = this.tickets.waiverUrl(b.refCode);
    const html = `<!doctype html><html><body style="margin:0;background:#F7F3FF;font-family:Arial,Helvetica,sans-serif;color:#340057">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div style="background:#340057;color:#FFFFFF;border-radius:18px 18px 0 0;padding:22px 24px">
    <div style="font-size:11px;letter-spacing:.16em;opacity:.7">VALLÉ ADVENATURE™ PARK</div>
    <div style="font-size:24px;font-weight:900;font-style:italic;margin-top:6px">Sign your waivers before you arrive</div>
  </div>
  <div style="height:8px;background:repeating-linear-gradient(-45deg,#33FF74 0 12px,#340057 12px 24px)"></div>
  <div style="background:#FFFFFF;padding:24px;border-radius:0 0 18px 18px;font-size:15px;line-height:1.5">
    <p style="margin:0 0 12px">Hi ${esc(b.guestName)}, one thing before your visit on <strong>${esc(longDate(dateStr(b.visitDate)))}</strong>:</p>
    <p style="margin:0 0 18px">Each participant needs a signed safety waiver (Disclaimer Form). Fill it in on your phone now, one per person, and walk straight past the paperwork at the gate.</p>
    <p style="text-align:center;margin:0 0 18px"><a href="${url}" style="background:#FF3358;color:#FFFFFF;text-decoration:none;font-weight:700;padding:13px 24px;border-radius:999px;display:inline-block">Sign the waivers</a></p>
    <p style="margin:0;font-size:12px;color:#7A6A93;word-break:break-all">${esc(url)}</p>
  </div>
  <p style="text-align:center;font-size:11px;color:#7A6A93;margin:16px 0 0">Booking ${esc(b.refCode)} · ${esc(PARK_PHONE)} · sales@vallepark.com</p>
</div></body></html>`;
    const [email, whatsapp] = await Promise.all([
      b.email ? this.mail.send({ to: b.email, subject: `Sign your safety waivers · ${b.refCode}`, text, html }) : Promise.resolve(false),
      b.phone ? this.whatsapp.sendText(b.phone, text) : Promise.resolve(false),
    ]);
    this.logger.log(`Waiver link ${b.refCode}: e-mail ${email ? 'sent' : 'not sent'}, WhatsApp ${whatsapp ? 'sent' : 'not sent'}`);
    return { email, whatsapp };
  }

  // ---------------------------------------------------------------- reminder

  /** `statusLine` is the desk's park notice of the moment (open / partly open / closed), when there is one. */
  reminderText(b: Booking, statusLine = ''): string {
    return [
      `See you tomorrow at VALLÉ Advenature™ Park, ${b.guestName.split(' ')[0]}! 🌴`,
      `${longDate(dateStr(b.visitDate))} · ${slotLabel(b.slot)} · ${party(b)}`,
      ...(statusLine ? [`⚠️ ${statusLine}`] : []),
      (b.paidAmount ?? 0) >= b.total ? 'Already paid.' : `${this.payLine(b)} (cash or card).`,
      ``,
      `Your ticket: ${this.tickets.ticketUrl(b.refCode)}`,
      `Waivers: sign them tonight and skip the queue at the gate: ${this.tickets.waiverUrl(b.refCode)}`,
      `Directions: ${MAPS}`,
      `Bring closed shoes, sunscreen and water. Reply here or call ${PARK_PHONE} if anything changes.`,
    ].join('\n');
  }

  async sendReminder(b: Booking): Promise<boolean> {
    const statusLine = await this.parkStatus?.line().catch(() => '') ?? '';
    const text = this.reminderText(b, statusLine);
    const [email, wa] = await Promise.all([
      b.email ? this.mail.send({ to: b.email, subject: `Tomorrow at VALLÉ · ${b.refCode}`, text }) : Promise.resolve(false),
      b.phone ? this.whatsapp.sendBooking('reminder', b.phone, this.reminderWhatsApp(b)) : Promise.resolve(false),
    ]);
    if (email || wa) await this.bookingRepo.update({ id: b.id }, { reminderSentAt: new Date() });
    return email || wa;
  }

  /** Bookings for tomorrow that have not been reminded yet; runs from 17:00 park time. */
  async dueReminders(now: Date = parkNow()): Promise<Booking[]> {
    if (now.getHours() < REMINDER_HOUR) return [];
    const tomorrow = addDays(parkToday(), 1);
    return this.bookingRepo.find({ where: { visitDate: tomorrow, status: 'confirmed', reminderSentAt: IsNull() } });
  }

  private async sendDueReminders(): Promise<void> {
    if (!this.mail.enabled && !this.whatsapp.enabled) return;
    try {
      const due = await this.dueReminders();
      for (const b of due) await this.sendReminder(b);
      if (due.length) this.logger.log(`Sent ${due.length} visit reminder(s) for tomorrow`);
    } catch (e) {
      this.logger.warn(`Reminder sweep failed: ${(e as Error).message}`);
    }
  }
}
