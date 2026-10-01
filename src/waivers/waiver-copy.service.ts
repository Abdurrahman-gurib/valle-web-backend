import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Booking, Waiver } from '../entities';
import { MailService } from '../notifications/mail.service';
import { WhatsAppService } from '../notifications/whatsapp.service';
import { TicketService } from '../tickets/ticket.service';
import { TERMS, type TermsLang } from './terms';
import { renderWaiverPdf } from './waiver-pdf';

export interface CopySent {
  email: boolean;
  whatsapp: boolean;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

const SUBJECT: Record<TermsLang, string> = {
  en: 'Your signed Disclaimer Form',
  fr: 'Votre formulaire de décharge signé',
  de: 'Ihre unterschriebene Haftungsausschlusserklärung',
  it: 'Il suo modulo di esonero firmato',
  ar: 'نموذج إخلاء المسؤولية الموقّع',
  ru: 'Ваша подписанная Форма отказа от ответственности',
};
const INTRO: Record<TermsLang, string> = {
  en: 'Thank you. Here is the copy of the Disclaimer Form signed for {name} (booking {ref}). The PDF is attached; keep it for your visit.',
  fr: 'Merci. Voici la copie du formulaire de décharge signé pour {name} (réservation {ref}). Le PDF est joint ; conservez-le pour votre visite.',
  de: 'Vielen Dank. Hier ist die Kopie der für {name} unterschriebenen Erklärung (Buchung {ref}). Das PDF liegt bei; bitte für Ihren Besuch aufbewahren.',
  it: 'Grazie. Ecco la copia del modulo di esonero firmato per {name} (prenotazione {ref}). Il PDF è allegato; lo conservi per la visita.',
  ar: 'شكرًا لكم. هذه نسخة نموذج إخلاء المسؤولية الموقّع باسم {name} (الحجز {ref}). ملف PDF مرفق؛ احتفظوا به لزيارتكم.',
  ru: 'Спасибо. Это копия Формы отказа от ответственности, подписанной для {name} (бронирование {ref}). PDF во вложении; сохраните его для визита.',
};

/**
 * Sends the guest their copy of a signed waiver: an e-mail in the language
 * they read it in (with the PDF attached and the signature inline) and a
 * WhatsApp document message through the approved template. Never throws.
 */
@Injectable()
export class WaiverCopyService {
  private readonly logger = new Logger(WaiverCopyService.name);
  private readonly siteUrl: string;

  constructor(
    private readonly mail: MailService,
    private readonly whatsapp: WhatsAppService,
    private readonly tickets: TicketService,
    config: ConfigService,
  ) {
    this.siteUrl = (config.get<string>('SITE_URL') ?? 'https://vallepark.com').trim().replace(/\/+$/, '');
  }

  /** Public PDF link, guarded by the ticket token like the rest of the guest's pages. */
  pdfUrl(b: Booking, w: Waiver): string {
    return `${this.siteUrl}/api/tickets/${encodeURIComponent(b.refCode)}/waivers/${w.id}.pdf?t=${this.tickets.token(b.refCode)}`;
  }

  pdf(w: Waiver, b: Booking): Promise<Buffer> {
    return renderWaiverPdf(w, b, { siteUrl: this.siteUrl });
  }

  renderEmail(w: Waiver, b: Booking): { subject: string; text: string; html: string } {
    const lang = (['en', 'fr', 'de', 'it', 'ar', 'ru'].includes(w.lang) ? w.lang : 'en') as TermsLang;
    const T = TERMS[lang];
    const L = T.labels;
    const rtl = lang === 'ar';
    const intro = INTRO[lang].replace('{name}', w.participantName).replace('{ref}', b.refCode);
    const subject = `${SUBJECT[lang]} · ${b.refCode}`;
    const rows: [string, string][] = [
      [L.name, w.participantName], [L.birth, String(w.birthDate).slice(0, 10)], [`${L.height} / ${L.weight}`, `${w.heightCm} cm · ${w.weightKg} kg`],
      ...(w.isMinor ? [[L.guardian, w.guardianName] as [string, string]] : []),
      [L.address, w.address], [L.email, w.email], [L.phone, w.phone], [L.nationality, w.nationality], [L.idNumber, w.idNumber],
      [L.emName, w.emergencyName], [L.emPhone, w.emergencyPhone], [L.medical, w.medicalNotes],
    ].filter(([, v]) => !!v) as [string, string][];
    const text = [
      intro, '',
      ...rows.map(([k, v]) => `${k}: ${v}`), '',
      L.hereby, ...T.clauses.map((c, i) => `${i + 1}. ${c}`), '',
      `${w.isMinor ? L.sigGuardian : L.sigParticipant}: ${w.signedBy} · ${w.signedAt.toISOString()}`,
      `PDF: ${this.pdfUrl(b, w)}`,
    ].join('\n');
    const html = `<!doctype html><html dir="${rtl ? 'rtl' : 'ltr'}" lang="${lang}"><body style="margin:0;background:#F7F3FF;font-family:Arial,Helvetica,sans-serif;color:#340057">
<div style="max-width:600px;margin:0 auto;padding:24px 16px">
  <div style="background:#340057;color:#FFFFFF;border-radius:18px 18px 0 0;padding:20px 24px">
    <div style="font-size:11px;letter-spacing:.16em;opacity:.7">VALLÉ ADVENATURE™ PARK</div>
    <div style="font-size:22px;font-weight:900;font-style:italic;margin-top:6px">${esc(L.title)}</div>
    <div style="font-size:12px;opacity:.85;margin-top:2px">${esc(L.company)}</div>
  </div>
  <div style="height:8px;background:repeating-linear-gradient(-45deg,#33FF74 0 12px,#340057 12px 24px)"></div>
  <div style="background:#FFFFFF;padding:22px 24px;border-radius:0 0 18px 18px;font-size:14px;line-height:1.5">
    <p style="margin:0 0 14px">${esc(intro)}</p>
    <p style="text-align:center;margin:0 0 18px"><a href="${this.pdfUrl(b, w)}" style="background:#FF3358;color:#FFFFFF;text-decoration:none;font-weight:700;padding:11px 22px;border-radius:999px;display:inline-block">PDF</a></p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">${rows.map(([k, v]) => `<tr><td style="padding:4px 8px 4px 0;color:#7333FF;font-size:11px;letter-spacing:.06em;vertical-align:top;width:45%">${esc(k.toUpperCase())}</td><td style="padding:4px 0">${esc(v)}</td></tr>`).join('')}</table>
    <hr style="border:0;border-top:1px dashed #D9CCF2;margin:16px 0">
    <p style="margin:0 0 6px;font-size:13px">${esc(L.intro)}</p>
    <p style="margin:0 0 6px;font-weight:700;font-size:13px">${esc(L.hereby)}</p>
    <ol style="margin:0;padding-inline-start:20px;font-size:12.5px">${T.clauses.map((c) => `<li style="margin-bottom:6px">${esc(c)}</li>`).join('')}</ol>
    <hr style="border:0;border-top:1px dashed #D9CCF2;margin:16px 0">
    <p style="margin:0 0 4px;font-size:12px">&#9745; ${esc(L.c_terms)}<br>&#9745; ${esc(L.c_health)}<br>&#9745; ${esc(L.c_consent)}<br>${w.marketingConsent ? '&#9745;' : '&#9744;'} ${esc(L.marketing)}</p>
    <hr style="border:0;border-top:1px dashed #D9CCF2;margin:16px 0">
    <div style="font-size:11px;letter-spacing:.06em;color:#7333FF">${esc((w.isMinor ? L.sigGuardian : L.sigParticipant).toUpperCase())}</div>
    <img src="cid:waiver-signature" alt="signature" width="220" style="display:block;max-width:220px;border:1px solid #EBE2FF;border-radius:10px;margin:6px 0;background:#FFFFFF">
    <div style="font-size:13px"><strong>${esc(w.signedBy)}</strong> · ${esc(w.signedAt.toLocaleString('en-GB', { timeZone: 'Indian/Mauritius', hour12: false }))} (Mauritius) · IP ${esc(w.ip || '-')} · ${esc(w.termsVersion)}</div>
  </div>
  <p style="text-align:center;font-size:11px;color:#7A6A93;margin:16px 0 0">Mare Anguilles Farms Ltd · VALLÉ Advenature™ Park · B102, Mare Anguilles, Chamouny · +230 660 44 77</p>
</div></body></html>`;
    return { subject, text, html };
  }

  async send(w: Waiver, b: Booking): Promise<CopySent> {
    const to = (w.email || b.email || '').trim();
    const phone = (w.phone || b.phone || '').trim();
    let email = false;
    let whatsapp = false;
    try {
      if (to && this.mail.enabled) {
        const pdf = await this.pdf(w, b);
        const { subject, text, html } = this.renderEmail(w, b);
        const signature = Buffer.from(w.signaturePng.replace(/^data:image\/png;base64,/, ''), 'base64');
        email = await this.mail.send({
          to, subject, text, html,
          attachments: [
            { filename: `valle-disclaimer-${b.refCode}-${w.participantName.replace(/[^A-Za-z0-9]+/g, '-')}.pdf`, content: pdf, contentType: 'application/pdf' },
            { filename: 'signature.png', content: signature, contentType: 'image/png', cid: 'waiver-signature' },
          ],
        });
      }
    } catch (e) {
      this.logger.error(`Waiver copy e-mail for ${b.refCode}/${w.participantName} failed: ${(e as Error).message}`);
    }
    if (phone) {
      whatsapp = await this.whatsapp.sendDocument(phone, {
        link: this.pdfUrl(b, w),
        filename: `valle-disclaimer-${b.refCode}.pdf`,
        params: [w.participantName, b.refCode],
        ticketPath: `${b.refCode}?t=${this.tickets.token(b.refCode)}`,
        text: `${INTRO['en'].replace('{name}', w.participantName).replace('{ref}', b.refCode)}\n${this.pdfUrl(b, w)}`,
      });
    }
    this.logger.log(`Waiver copy ${b.refCode}/${w.participantName}: e-mail ${email ? 'sent' : 'not sent'}, WhatsApp ${whatsapp ? 'sent' : 'not sent'}`);
    return { email, whatsapp };
  }
}
