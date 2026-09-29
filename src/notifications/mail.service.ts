import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

export interface MailAttachment { filename: string; content: Buffer; contentType: string; cid?: string }
export interface Mail { to: string; subject: string; text: string; html?: string; attachments?: MailAttachment[] }

/**
 * One SMTP transport for everything the park sends (guest tickets, reminders,
 * the desk's new-booking alert). Production points SMTP_URL at Resend
 * (smtps://resend:<api key>@smtp.resend.com:465, domain vallepark.com verified
 * there); "json" is the test transport that renders without sending; unset
 * means no mail at all, logged once.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  readonly from: string;

  constructor(config: ConfigService) {
    const url = (config.get<string>('SMTP_URL') ?? '').trim();
    this.from = (config.get<string>('MAIL_FROM') ?? 'VALLÉ Advenature Park <bookings@vallepark.com>').trim();
    if (url === 'json') this.transporter = nodemailer.createTransport({ jsonTransport: true });
    else if (url) this.transporter = nodemailer.createTransport(url);
    else {
      this.transporter = null;
      this.logger.warn('SMTP_URL is not set: no e-mail will be sent (tickets, reminders, desk alerts)');
    }
  }

  get enabled(): boolean {
    return this.transporter !== null;
  }

  /** Never throws: a mail problem is logged, the booking stands. */
  async send(mail: Mail): Promise<boolean> {
    if (!this.transporter) return false;
    try {
      await this.transporter.sendMail({ from: this.from, ...mail });
      return true;
    } catch (e) {
      this.logger.error(`Could not send "${mail.subject}" to ${mail.to}: ${(e as Error).message}`);
      return false;
    }
  }
}
