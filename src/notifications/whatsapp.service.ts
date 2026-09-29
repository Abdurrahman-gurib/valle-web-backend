import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * WhatsApp messages to guests through Twilio's WhatsApp API (Meta requires a
 * business provider; Twilio is the simplest to set up in Mauritius).
 *
 *   TWILIO_ACCOUNT_SID    ACxxxxxxxx
 *   TWILIO_AUTH_TOKEN     the account's auth token
 *   TWILIO_WHATSAPP_FROM  whatsapp:+2306604477 (the approved sender), or the
 *                         sandbox number whatsapp:+14155238886 while testing
 *
 * Unset: disabled, logged once; the guest still gets the ticket by e-mail and
 * can add it to WhatsApp from the ticket page. Business-initiated messages
 * outside a 24-hour window need an approved template on the Meta side; the
 * sandbox accepts free text.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly sid: string;
  private readonly token: string;
  private readonly from: string;
  /** Overridable in tests. */
  post: (url: string, auth: string, body: URLSearchParams) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }> =
    (url, auth, body) => fetch(url, { method: 'POST', headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(10_000) });

  constructor(config: ConfigService) {
    this.sid = (config.get<string>('TWILIO_ACCOUNT_SID') ?? '').trim();
    this.token = (config.get<string>('TWILIO_AUTH_TOKEN') ?? '').trim();
    this.from = (config.get<string>('TWILIO_WHATSAPP_FROM') ?? '').trim();
    if (!this.enabled) this.logger.warn('TWILIO_* not set: WhatsApp messages to guests are disabled (tickets still go by e-mail)');
  }

  get enabled(): boolean {
    return Boolean(this.sid && this.token && this.from);
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

  /** Never throws. */
  async send(phone: string, body: string): Promise<boolean> {
    if (!this.enabled) return false;
    const to = WhatsAppService.normalise(phone);
    if (!to) { this.logger.warn(`Cannot WhatsApp "${phone}": not a usable number`); return false; }
    try {
      const res = await this.post(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.sid)}/Messages.json`,
        Buffer.from(`${this.sid}:${this.token}`).toString('base64'),
        new URLSearchParams({ From: this.from, To: 'whatsapp:' + to, Body: body }),
      );
      if (!res.ok) { this.logger.error(`WhatsApp to ${to} refused (${res.status}): ${(await res.text()).slice(0, 200)}`); return false; }
      return true;
    } catch (e) {
      this.logger.error(`WhatsApp to ${to} failed: ${(e as Error).message}`);
      return false;
    }
  }
}
