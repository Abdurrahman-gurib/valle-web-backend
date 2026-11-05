import { Injectable, Optional, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Booking, BookingLine } from '../entities';
import { TicketService } from '../tickets/ticket.service';
import { ParkStatusService } from '../weather/park-status.service';
import { Waiver } from '../entities/waiver.entity';
import { Setting } from '../entities/setting.entity';
import { parseWaiverActivities, waiverRequiredCount } from '../waivers/waiver-rules';
import { productActivityMap } from '../waivers/waiver-products';
import { MailService } from './mail.service';
import { WhatsAppService, type BookingMessage } from './whatsapp.service';
import { escapeHtml as esc } from '../common/html';
import { addDays, isoDay, parkNow, parkToday } from '../common/park-time';
import {
  emailFrame, firstName, MAPS, PARK_ADDRESS, PARK_PHONE, party, payLine, payText, pinkButton, slotLabel, waiverDeadline,
} from './guest-messages';
import { dateIn, guestLang, isRtl, moneyIn, plural, t, th, type GuestLang } from './i18n';

const REMINDER_HOUR = 17; // sent between 17:00 and midnight, park time, the evening before
const REMINDER_SWEEP_MS = 15 * 60 * 1000;

/** The guest's language: the one the booking was made in (English when unknown). */
const langOf = (b: Booking): GuestLang => guestLang(b.lang);
const visitDay = (b: Booking, lang: GuestLang = langOf(b)): string => dateIn(isoDay(b.visitDate), lang);
const SIGNATURE = `VALLÉ Advenature™ Park · ${PARK_PHONE} · sales@vallepark.com`;
/** A bare link shown under a button; kept left to right inside an Arabic card. */
const linkLine = (url: string, lang: GuestLang): string =>
  `    <p style="margin:0;font-size:12px;color:#7A6A93;word-break:break-all"${isRtl(lang) ? ' dir="ltr"' : ''}>${esc(url)}</p>`;

/**
 * What the guest receives: the ticket (with QR) right after booking, by e-mail
 * and, when a WhatsApp sender is configured, by WhatsApp; and a reminder the
 * evening before the visit. Sending never blocks or fails a booking.
 *
 * Everything is written in the booking's language (booking.lang) from the
 * catalogue in ./i18n, except the parameters of the approved WhatsApp
 * templates, which stay English until per-language templates are approved
 * (see DEPLOYMENT.md). Activity and package names are the English catalogue names.
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
    @Optional() @InjectRepository(Waiver) private readonly waiverRepo?: Repository<Waiver>,
    @Optional() @InjectRepository(Setting) private readonly settingRepo?: Repository<Setting>,
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

  /**
   * Visit line of the WhatsApp templates: "Friday 2 October 2026, morning arrival 09:00 to 12:00".
   * English: the approved templates are English, a translated parameter would sit in an English sentence.
   */
  private visitLine(b: Booking): string {
    return `${visitDay(b, 'en')}, ${t('en', b.slot === 'morning' ? 'slotInline_morning' : 'slotInline_afternoon')}`;
  }

  /** Template parameters (360dialog, English like the template) plus the full text in the guest's language (Twilio fallback). */
  ticketWhatsApp(b: Booking): BookingMessage {
    return {
      params: [firstName(b), b.refCode, this.visitLine(b), party(b), payLine(b)],
      ticketPath: `${b.refCode}?t=${this.tickets.token(b.refCode)}`,
      text: this.ticketWhatsAppText(b),
    };
  }

  reminderWhatsApp(b: Booking): BookingMessage {
    return {
      params: [firstName(b), this.visitLine(b), payLine(b)],
      ticketPath: `${b.refCode}?t=${this.tickets.token(b.refCode)}`,
      text: this.reminderText(b),
    };
  }

  ticketWhatsAppText(b: Booking): string {
    const lang = langOf(b);
    return [
      t(lang, 'waTicket_hi', { name: b.guestName.split(' ')[0] }),
      t(lang, 'reference', { ref: b.refCode }),
      `${visitDay(b)} · ${slotLabel(b.slot, lang)}`,
      `${party(b, lang)} · ${payLine(b, lang)}`,
      ``,
      t(lang, 'waTicket_qr', { url: this.tickets.ticketUrl(b.refCode, b.lang) }),
      t(lang, 'waTicket_waiver', { deadline: this.waiverDeadline(b), url: this.tickets.waiverUrl(b.refCode, b.lang) }),
      t(lang, 'waTicket_gate', { maps: MAPS }),
      t(lang, 'questions', { phone: PARK_PHONE }),
    ].join('\n');
  }

  /** Subject, text and HTML of the ticket e-mail (exported for tests). */
  renderTicketEmail(b: Booking, lines: BookingLine[]): { subject: string; text: string; html: string } {
    const lang = langOf(b);
    const rs = (n: number) => moneyIn(n, lang);
    const end = isRtl(lang) ? 'left' : 'right';
    const visit = visitDay(b);
    const url = this.tickets.ticketUrl(b.refCode, b.lang);
    const waiver = this.tickets.waiverUrl(b.refCode, b.lang);
    const deadline = this.waiverDeadline(b);
    const pay = payText(b, lang, 'ticketPay');
    const who = party(b, lang);
    const subject = t(lang, 'ticket_subject', { ref: b.refCode, date: visit });
    const lineText = lines.map((l) => `  • ${l.label}: ${rs(l.amount)}`).join('\n');
    const text = [
      t(lang, 'hiComma', { name: b.guestName }),
      ``,
      t(lang, 'ticket_booked'),
      ``,
      t(lang, 'reference', { ref: b.refCode }),
      t(lang, 'ticket_visit', { date: visit }),
      slotLabel(b.slot, lang),
      t(lang, 'ticket_party', { party: who, rate: t(lang, b.rate === 'nr' ? 'rate_visitor' : 'rate_residentId') }),
      lineText,
      t(lang, 'ticket_total', { total: rs(b.total), pay }),
      ``,
      t(lang, 'yourTicket', { url }),
      ``,
      t(lang, 'ticket_waiver', { deadline, url: waiver }),
      ``,
      t(lang, 'ticket_gettingHere', { address: PARK_ADDRESS, maps: MAPS }),
      t(lang, 'ticket_bring'),
      t(lang, 'ticket_cancel', { phone: PARK_PHONE }),
      ``,
      t(lang, 'ticket_seeYou'),
      SIGNATURE,
    ].join('\n');
    const lineRows = lines.map((l) => `<tr><td style="padding:6px 0;color:#340057">${esc(l.label)}</td><td style="padding:6px 0;text-align:${end};font-family:monospace;color:#340057">${rs(l.amount)}</td></tr>`).join('');
    const label = 'padding:6px 0;color:#7333FF;font-size:11px;letter-spacing:.12em';
    const html = emailFrame({
      lang,
      title: th(lang, 'ticket_title'),
      titleSize: 26,
      footer: `VALLÉ Advenature™ Park · ${esc(PARK_ADDRESS)} · ${esc(PARK_PHONE)} · sales@vallepark.com`,
      body: [
        `    <p style="margin:0 0 14px;font-size:15px;line-height:1.5">${th(lang, 'ticket_intro', { name: b.guestName })}</p>`,
        `    <div style="text-align:center;margin:10px 0 18px"><img src="cid:ticket-qr" alt="${th(lang, 'ticket_qrAlt', { ref: b.refCode })}" width="220" height="220" style="display:inline-block;border:1px solid #EBE2FF;border-radius:12px;padding:8px;background:#FFFFFF"></div>`,
        `    <div style="text-align:center;font-family:monospace;font-size:24px;font-weight:700;color:#FF3358;letter-spacing:.06em">${esc(b.refCode)}</div>`,
        `    <table style="width:100%;border-collapse:collapse;margin-top:18px;font-size:14px">`,
        `      <tr><td style="${label}">${th(lang, 'label_visit')}</td><td style="padding:6px 0;text-align:${end}">${esc(visit)}</td></tr>`,
        `      <tr><td style="${label}">${th(lang, 'label_arrival')}</td><td style="padding:6px 0;text-align:${end}">${esc(slotLabel(b.slot, lang))}</td></tr>`,
        `      <tr><td style="${label}">${th(lang, 'label_party')}</td><td style="padding:6px 0;text-align:${end}">${esc(who)} · ${th(lang, b.rate === 'nr' ? 'rate_visitor' : 'rate_residentIdShort')}</td></tr>`,
        `    </table>`,
        `    <hr style="border:0;border-top:1px dashed #D9CCF2;margin:14px 0">`,
        `    <table style="width:100%;border-collapse:collapse;font-size:14px">${lineRows}`,
        `      <tr><td style="padding:10px 0 0;font-weight:800;font-size:16px">${th(lang, 'label_total')}</td><td style="padding:10px 0 0;text-align:${end};font-weight:800;font-size:16px;font-family:monospace">${rs(b.total)}</td></tr>`,
        `    </table>`,
        `    <p style="margin:8px 0 0;font-size:13px;color:#7333FF;font-weight:700">${esc(pay)}</p>`,
        `    <p style="text-align:center;margin:22px 0 6px">${pinkButton(url, th(lang, 'btn_openTicket'))}</p>`,
        `    <p style="text-align:center;margin:0;font-size:12px;color:#7A6A93">${th(lang, 'ticket_save')}</p>`,
        `    <div style="margin:20px 0 0;background:#FFFDE0;border:1.5px solid #FFE94D;border-radius:14px;padding:16px 18px">`,
        `      <p style="margin:0 0 6px;font-size:14px;font-weight:800">${th(lang, 'ticket_signHead', { deadline })}</p>`,
        `      <p style="margin:0 0 12px;font-size:13px;line-height:1.5">${th(lang, 'ticket_signBody')}</p>`,
        `      <a href="${waiver}" style="background:#340057;color:#FFFFFF;text-decoration:none;font-weight:700;padding:10px 20px;border-radius:999px;display:inline-block;font-size:14px">${th(lang, 'btn_signWaivers')}</a>`,
        `    </div>`,
        `    <hr style="border:0;border-top:1px dashed #D9CCF2;margin:20px 0">`,
        `    <p style="margin:0 0 8px;font-size:13px;line-height:1.55"><strong>${th(lang, 'ticket_hereHead')}</strong> ${esc(PARK_ADDRESS)}. <a href="${MAPS}" style="color:#7333FF">${th(lang, 'ticket_openMaps')}</a>. ${th(lang, 'ticket_parking')}</p>`,
        `    <p style="margin:0 0 8px;font-size:13px;line-height:1.55"><strong>${th(lang, 'ticket_bringHead')}</strong> ${th(lang, 'ticket_bringBody')}</p>`,
        `    <p style="margin:0;font-size:13px;line-height:1.55"><strong>${th(lang, 'ticket_changeHead')}</strong> ${th(lang, 'ticket_changeBody', { phone: PARK_PHONE })}</p>`,
      ].join('\n'),
    });
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
    const lang = langOf(b);
    return [
      t(lang, 'waiverLink_text1', { name: firstName(b), date: visitDay(b) }),
      t(lang, 'waiverLink_text2', { deadline: this.waiverDeadline(b) }),
      this.tickets.waiverUrl(b.refCode, b.lang),
      ``,
      t(lang, 'bookingQuestions', { ref: b.refCode, phone: PARK_PHONE }),
    ].join('\n');
  }

  /** Subject, text and HTML of the waiver nudge (exported for tests). */
  renderWaiverLinkEmail(b: Booking, waivers?: { signed: number; required: number }): { subject: string; text: string; html: string } {
    const lang = langOf(b);
    const text = this.waiverLinkText(b);
    const left = waivers && waivers.required > 0 ? t(lang, 'waiverLink_left', { left: waivers.required - waivers.signed, required: waivers.required }) : '';
    const url = this.tickets.waiverUrl(b.refCode, b.lang);
    const html = emailFrame({
      lang,
      title: th(lang, 'waiverLink_title'),
      titleSize: 24,
      cardStyle: ';font-size:15px;line-height:1.5',
      footer: th(lang, 'footerBooking', { ref: b.refCode, phone: PARK_PHONE }),
      body: [
        `    <p style="margin:0 0 12px">${th(lang, 'waiverLink_html1', { name: b.guestName, date: visitDay(b) })}</p>`,
        `    <p style="margin:0 0 18px">${esc(left)}${th(lang, 'waiverLink_html2', { deadline: this.waiverDeadline(b) })}</p>`,
        `    <p style="text-align:center;margin:0 0 18px">${pinkButton(url, th(lang, 'btn_signWaivers'))}</p>`,
        linkLine(url, lang),
      ].join('\n'),
    });
    return { subject: t(lang, 'waiverLink_subject', { ref: b.refCode }), text, html };
  }

  /** Staff re-sends the waiver link: e-mail always, WhatsApp when the 24-hour window allows a plain message. */
  async sendWaiverLink(b: Booking, waivers?: { signed: number; required: number }): Promise<{ email: boolean; whatsapp: boolean }> {
    const { subject, text, html } = this.renderWaiverLinkEmail(b, waivers);
    const [email, whatsapp] = await Promise.all([
      b.email ? this.mail.send({ to: b.email, subject, text, html }) : Promise.resolve(false),
      b.phone ? this.whatsapp.sendText(b.phone, text) : Promise.resolve(false),
    ]);
    this.logger.log(`Waiver link ${b.refCode}: e-mail ${email ? 'sent' : 'not sent'}, WhatsApp ${whatsapp ? 'sent' : 'not sent'}`);
    return { email, whatsapp };
  }

  // ---------------------------------------------------------------- reminder

  /**
   * The waiver deadline as guests read it, in the booking's language: the
   * evening before the visit, or "before you arrive" when the visit is tomorrow or today.
   */
  waiverDeadline(b: Booking): string {
    return waiverDeadline(isoDay(b.visitDate), parkToday(), langOf(b));
  }

  /** Signed / required waivers of a booking, 0/0 when the booking needs none. */
  async waiverStatus(b: Booking): Promise<{ signed: number; required: number }> {
    if (!this.waiverRepo || !this.settingRepo) return { signed: 0, required: 0 };
    const [signed, lines, setting] = await Promise.all([
      this.waiverRepo.count({ where: { bookingId: b.id, supersededAt: IsNull() } }),
      this.lineRepo.find({ where: { bookingId: b.id } }),
      this.settingRepo.findOne({ where: { key: 'waiver_activities' } }),
    ]);
    const packages = await productActivityMap(this.lineRepo.manager, lines.map((l) => l.productKey));
    return { signed, required: waiverRequiredCount(lines, parseWaiverActivities(setting?.value), b, packages) };
  }

  /**
   * `statusLine` is the desk's park notice of the moment (open / partly open / closed), when there is one,
   * passed on as the desk wrote it; `waivers` what is signed so far (the line changes from a nudge to a tick).
   */
  reminderText(b: Booking, statusLine = '', waivers?: { signed: number; required: number }): string {
    const lang = langOf(b);
    const waiverUrl = this.tickets.waiverUrl(b.refCode, b.lang);
    const waiverLine = !waivers || waivers.required === 0
      ? t(lang, 'rem_waiverOpen', { url: waiverUrl })
      : waivers.signed >= waivers.required
        ? t(lang, 'rem_waiverDone', { required: waivers.required })
        : t(lang, 'rem_waiverMissing', { left: waivers.required - waivers.signed, required: waivers.required, url: waiverUrl });
    return [
      t(lang, 'rem_hi', { name: b.guestName.split(' ')[0] }),
      `${visitDay(b)} · ${slotLabel(b.slot, lang)} · ${party(b, lang)}`,
      ...(statusLine ? [`⚠️ ${statusLine}`] : []),
      (b.paidAmount ?? 0) >= b.total ? t(lang, 'rem_paid') : t(lang, 'rem_pay', { pay: payLine(b, lang) }),
      ``,
      t(lang, 'yourTicket', { url: this.tickets.ticketUrl(b.refCode, b.lang) }),
      waiverLine,
      t(lang, 'directions', { maps: MAPS }),
      t(lang, 'rem_bring', { phone: PARK_PHONE }),
    ].join('\n');
  }

  /** Subject, text and HTML of the reminder e-mail (the HTML carries the language and, for Arabic, dir="rtl"). */
  renderReminderEmail(b: Booking, statusLine = '', waivers?: { signed: number; required: number }): { subject: string; text: string; html: string } {
    const lang = langOf(b);
    const text = this.reminderText(b, statusLine, waivers);
    const [first, ...rest] = text.split('\n');
    const html = emailFrame({
      lang,
      title: th(lang, 'rem_title'),
      titleSize: 24,
      cardStyle: ';font-size:15px;line-height:1.5',
      footer: th(lang, 'footerBooking', { ref: b.refCode, phone: PARK_PHONE }),
      body: [
        `    <p style="margin:0 0 12px;font-weight:700">${esc(first)}</p>`,
        ...rest.filter(Boolean).map((l) => `    <p style="margin:0 0 8px;word-break:break-word">${esc(l)}</p>`),
        `    <p style="text-align:center;margin:18px 0 0">${pinkButton(this.tickets.ticketUrl(b.refCode, b.lang), th(lang, 'btn_openTicket'))}</p>`,
      ].join('\n'),
    });
    return { subject: t(lang, 'rem_subject', { ref: b.refCode }), text, html };
  }

  async sendReminder(b: Booking): Promise<boolean> {
    const [statusLine, waivers] = await Promise.all([
      this.parkStatus?.line().catch(() => '') ?? Promise.resolve(''),
      this.waiverStatus(b).catch(() => ({ signed: 0, required: 0 })),
    ]);
    const { subject, text, html } = this.renderReminderEmail(b, statusLine, waivers);
    const [email, wa] = await Promise.all([
      b.email ? this.mail.send({ to: b.email, subject, text, html }) : Promise.resolve(false),
      b.phone ? this.whatsapp.sendBooking('reminder', b.phone, this.reminderWhatsApp(b)) : Promise.resolve(false),
    ]);
    if (email || wa) await this.bookingRepo.update({ id: b.id }, { reminderSentAt: new Date() });
    // Unsigned the evening before: the waiver mail with its button goes too, once.
    if (waivers.required > waivers.signed && !b.waiverReminderSentAt) {
      const nudged = await this.sendWaiverLink(b, waivers).catch(() => ({ email: false, whatsapp: false }));
      if (nudged.email || nudged.whatsapp) await this.bookingRepo.update({ id: b.id }, { waiverReminderSentAt: new Date() });
    }
    return email || wa;
  }

  /** "Your photos are ready": the ticket page now carries the visit photos. */
  async sendPhotosReady(b: Booking, count: number): Promise<{ email: boolean; whatsapp: boolean }> {
    const lang = langOf(b);
    const url = this.tickets.ticketUrl(b.refCode, b.lang) + '#photos';
    const first = firstName(b);
    const text = [
      t(lang, 'photos_hi', { name: first }),
      plural(lang, 'photos_text', count, { date: visitDay(b) }),
      url,
      ``,
      t(lang, 'bookingQuestions', { ref: b.refCode, phone: PARK_PHONE }),
    ].join('\n');
    const html = emailFrame({
      lang,
      title: th(lang, 'photos_title'),
      titleSize: 24,
      cardStyle: ';font-size:15px;line-height:1.5',
      footer: th(lang, 'footerBooking', { ref: b.refCode, phone: PARK_PHONE }),
      body: [
        `    <p style="margin:0 0 12px">${plural(lang, 'photos_html', count, { name: first, date: visitDay(b) }, true)}</p>`,
        `    <p style="text-align:center;margin:0 0 18px">${pinkButton(url, th(lang, 'btn_seePhotos'))}</p>`,
        linkLine(url, lang),
      ].join('\n'),
    });
    const [email, whatsapp] = await Promise.all([
      b.email ? this.mail.send({ to: b.email, subject: t(lang, 'photos_subject', { ref: b.refCode }), text, html }) : Promise.resolve(false),
      b.phone ? this.whatsapp.sendText(b.phone, text) : Promise.resolve(false),
    ]);
    return { email, whatsapp };
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
