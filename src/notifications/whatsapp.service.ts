import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * WhatsApp messages to guests.
 *
 * Primary provider: 360dialog (the park's WABA "Vallé Advenature Park",
 * +230 5292 8841, COEX: the WhatsApp Business app keeps working on the phone).
 *
 *   D360_API_KEY            the channel's API key (360dialog Hub > Channels > the number > API key)
 *   D360_BASE_URL           default https://waba-v2.360dialog.io
 *   WA_TEMPLATE_LANG        default en
 *   WA_TICKET_TEMPLATE      default valle_booking_ticket   (see scripts/whatsapp-templates.js)
 *   WA_REMINDER_TEMPLATE    default valle_visit_reminder
 *
 * A business may only open a conversation with an approved template, so the
 * ticket and the reminder are UTILITY templates whose "Open my ticket" button
 * carries the ticket path. Free text is only allowed inside the 24 hours after
 * the guest last wrote, which the park answers from the WhatsApp Business app.
 *
 * Fallback provider: Twilio (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN /
 * TWILIO_WHATSAPP_FROM), which sends the plain text instead of a template.
 * Neither configured: disabled, logged once; tickets still go by e-mail.
 */
export interface BookingMessage {
  /** Template body parameters, in order. */
  params: string[];
  /** Dynamic part of the "Open my ticket" URL button: "<ref>?t=<token>". */
  ticketPath: string;
  /** Full text, used by the Twilio fallback. */
  text: string;
}

/** A PDF sent through the waiver-copy template: header document, body params, ticket button. */
export interface DocumentMessage {
  link: string;
  filename: string;
  params: string[];
  ticketPath: string;
  /** Plain text for the Twilio fallback. */
  text: string;
}

type Post = (url: string, headers: Record<string, string>, body: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly d360Key: string;
  private readonly d360Base: string;
  private readonly lang: string;
  readonly templates: { ticket: string; reminder: string; waiver: string };
  private readonly twSid: string;
  private readonly twToken: string;
  private readonly twFrom: string;

  /** Overridable in tests. */
  post: Post = (url, headers, body) => fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) });

  constructor(config: ConfigService) {
    const get = (k: string) => (config.get<string>(k) ?? '').trim();
    this.d360Key = get('D360_API_KEY');
    this.d360Base = (get('D360_BASE_URL') || 'https://waba-v2.360dialog.io').replace(/\/+$/, '');
    this.lang = get('WA_TEMPLATE_LANG') || 'en';
    this.templates = { ticket: get('WA_TICKET_TEMPLATE') || 'valle_booking_ticket', reminder: get('WA_REMINDER_TEMPLATE') || 'valle_visit_reminder', waiver: get('WA_WAIVER_TEMPLATE') || 'valle_waiver_copy' };
    this.twSid = get('TWILIO_ACCOUNT_SID');
    this.twToken = get('TWILIO_AUTH_TOKEN');
    this.twFrom = get('TWILIO_WHATSAPP_FROM');
    if (!this.enabled) this.logger.warn('WhatsApp is off (no D360_API_KEY / TWILIO_*): tickets go by e-mail only');
    else this.logger.log(`WhatsApp via ${this.provider}`);
  }

  get provider(): '360dialog' | 'twilio' | null {
    if (this.d360Key) return '360dialog';
    if (this.twSid && this.twToken && this.twFrom) return 'twilio';
    return null;
  }

  get enabled(): boolean {
    return this.provider !== null;
  }

  /** "+230 5292 8841" / "5292 8841" / "0033 6 ..." -> E.164; Mauritian numbers get +230. */
  static normalise(phone: string): string | null {
    let digits = phone.replace(/[^\d+]/g, '');
    if (digits.startsWith('00')) digits = '+' + digits.slice(2);
    if (!digits.startsWith('+')) {
      const bare = digits.replace(/^0+/, '');
      if (bare.length === 7 || bare.length === 8) digits = '+230' + bare;
      else if (bare.length >= 10) digits = '+' + bare;
      else return null;
    }
    return /^\+\d{9,15}$/.test(digits) ? digits : null;
  }

  /** The Cloud API body for a template with body parameters and a dynamic URL button. */
  templatePayload(to: string, template: string, msg: BookingMessage): Record<string, unknown> {
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: template,
        language: { code: this.lang },
        components: [
          { type: 'body', parameters: msg.params.map((text) => ({ type: 'text', text: text.replace(/\s*\n\s*/g, ' ').slice(0, 1000) })) },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: msg.ticketPath }] },
        ],
      },
    };
  }

  /**
   * A template whose header is a PDF document (the signed waiver copy): the
   * document is fetched by Meta from `link`, so it must be a public URL.
   */
  documentPayload(to: string, template: string, doc: DocumentMessage): Record<string, unknown> {
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: template,
        language: { code: this.lang },
        components: [
          { type: 'header', parameters: [{ type: 'document', document: { link: doc.link, filename: doc.filename } }] },
          { type: 'body', parameters: doc.params.map((text) => ({ type: 'text', text: text.replace(/\s*\n\s*/g, ' ').slice(0, 1000) })) },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: doc.ticketPath }] },
        ],
      },
    };
  }

  /** The signed waiver copy as a document message. Never throws. */
  async sendDocument(phone: string, doc: DocumentMessage): Promise<boolean> {
    if (!this.enabled) return false;
    const to = WhatsAppService.normalise(phone);
    if (!to) { this.logger.warn(`Cannot WhatsApp "${phone}": not a usable number`); return false; }
    try {
      const res = this.provider === '360dialog'
        ? await this.post(`${this.d360Base}/messages`, { 'D360-API-KEY': this.d360Key, 'Content-Type': 'application/json' }, JSON.stringify(this.documentPayload(to, this.templates.waiver, doc)))
        : await this.post(
          `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.twSid)}/Messages.json`,
          { Authorization: 'Basic ' + Buffer.from(`${this.twSid}:${this.twToken}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
          new URLSearchParams({ From: this.twFrom, To: 'whatsapp:' + to, Body: doc.text, MediaUrl: doc.link }).toString(),
        );
      if (!res.ok) {
        this.logger.error(`WhatsApp waiver copy to ${to} refused by ${this.provider} (${res.status}): ${(await res.text()).slice(0, 300)}`);
        return false;
      }
      return true;
    } catch (e) {
      this.logger.error(`WhatsApp waiver copy to ${to} failed: ${(e as Error).message}`);
      return false;
    }
  }

  /** Ticket or reminder. Never throws. */
  async sendBooking(kind: 'ticket' | 'reminder', phone: string, msg: BookingMessage): Promise<boolean> {
    if (!this.enabled) return false;
    const to = WhatsAppService.normalise(phone);
    if (!to) { this.logger.warn(`Cannot WhatsApp "${phone}": not a usable number`); return false; }
    try {
      const res = this.provider === '360dialog'
        ? await this.post(
          `${this.d360Base}/messages`,
          { 'D360-API-KEY': this.d360Key, 'Content-Type': 'application/json' },
          JSON.stringify(this.templatePayload(to, this.templates[kind], msg)),
        )
        : await this.post(
          `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.twSid)}/Messages.json`,
          { Authorization: 'Basic ' + Buffer.from(`${this.twSid}:${this.twToken}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
          new URLSearchParams({ From: this.twFrom, To: 'whatsapp:' + to, Body: msg.text }).toString(),
        );
      if (!res.ok) {
        this.logger.error(`WhatsApp ${kind} to ${to} refused by ${this.provider} (${res.status}): ${(await res.text()).slice(0, 300)}`);
        return false;
      }
      return true;
    } catch (e) {
      this.logger.error(`WhatsApp ${kind} to ${to} failed: ${(e as Error).message}`);
      return false;
    }
  }
}
