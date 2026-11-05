import { addDays } from '../common/park-time';
import type { Booking } from '../entities';
import { dateIn, emailFont, isRtl, moneyIn, plural, t, type GuestLang } from './i18n';

/**
 * Pure pieces of what guests receive: wording shared by the ticket, the
 * reminder, the waiver nudge and the photos message, and the branded e-mail
 * frame they all sit in. GuestMessagingService adds the links and sends.
 * Every piece takes the guest's language (the booking's `lang`, English by
 * default); the words come from the catalogue in ./i18n.
 */

export const PARK_ADDRESS = 'B102, Mare Anguilles, Chamouny, Mauritius';
export const PARK_PHONE = '+230 660 4477';
export const MAPS = 'https://maps.google.com/?q=Vall%C3%A9+Advenature+Park+Chamouny';

export const slotLabel = (slot: string, lang: GuestLang = 'en'): string => t(lang, slot === 'morning' ? 'slot_morning' : 'slot_afternoon');

/** "2 adults and 1 child" (the joiner is the language's "and" unless given, e.g. " · " on the receipt). */
export function party(b: Pick<Booking, 'adults' | 'kids' | 'infants'>, lang: GuestLang = 'en', joiner = t(lang, 'and')): string {
  return [
    plural(lang, 'adults', b.adults),
    ...(b.kids ? [plural(lang, 'kids', b.kids)] : []),
    ...(b.infants ? [plural(lang, 'infants', b.infants)] : []),
  ].join(joiner);
}

/** The first word of the booking name, or the whole name when it has none. */
export const firstName = (b: Booking): string => b.guestName.split(' ')[0] || b.guestName;

/**
 * What the guest still owes, from the payment actually recorded on the booking
 * (never from payMode: choosing "pay online" takes no money until a gateway exists).
 */
export function payLine(b: Booking, lang: GuestLang = 'en'): string {
  return payText(b, lang, 'pay');
}

/** The four payment states (paid, deposit due, part paid, all at the gate), worded by `prefix`: pay_* or ticketPay_*. */
export function payText(b: Booking, lang: GuestLang, prefix: 'pay' | 'ticketPay'): string {
  const rs = (n: number) => moneyIn(n, lang);
  const paid = b.paidAmount ?? 0;
  if (paid >= b.total) return t(lang, `${prefix}_paid`, { total: rs(b.total) });
  if ((b.depositAmount ?? 0) > paid) return t(lang, `${prefix}_deposit`, { due: rs(b.depositAmount - paid), total: rs(b.total - paid) });
  if (paid > 0) return t(lang, `${prefix}_partial`, { paid: rs(paid), rest: rs(b.total - paid) });
  return t(lang, `${prefix}_onArrival`, { total: rs(b.total) });
}

/**
 * The waiver deadline as guests read it: the evening before the visit, or
 * "before you arrive" when the visit is tomorrow or today.
 */
export function waiverDeadline(visitDate: string, today: string, lang: GuestLang = 'en'): string {
  const eve = addDays(visitDate, -1);
  return eve > today ? t(lang, 'waiver_byEvening', { date: dateIn(eve, lang) }) : t(lang, 'waiver_beforeArrival');
}

/** ` lang=".." dir=".."` for the other languages; English keeps the bare frame it always had. */
const langAttrs = (lang: GuestLang): string => (lang === 'en' ? '' : ` lang="${lang}" dir="${isRtl(lang) ? 'rtl' : 'ltr'}"`);

/**
 * The branded e-mail frame: purple header with the title, the green stripe,
 * the white card (`body` is its inner HTML, already escaped) and the footer line.
 * Arabic reads right to left (dir="rtl" on html and body); Arabic and Hindi get
 * script-capable font stacks, and Arabic titles are not slanted.
 */
export function emailFrame(opts: { title: string; titleSize: number; cardStyle?: string; body: string; footer: string; lang?: GuestLang }): string {
  const lang = opts.lang ?? 'en';
  return `<!doctype html><html${langAttrs(lang)}><body style="margin:0;background:#F7F3FF;font-family:${emailFont(lang)};color:#340057"${langAttrs(lang)}>
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div style="background:#340057;color:#FFFFFF;border-radius:18px 18px 0 0;padding:22px 24px">
    <div style="font-size:11px;letter-spacing:.16em;opacity:.7">VALLÉ ADVENATURE™ PARK</div>
    <div style="font-size:${opts.titleSize}px;font-weight:900;font-style:${isRtl(lang) ? 'normal' : 'italic'};margin-top:6px">${opts.title}</div>
  </div>
  <div style="height:8px;background:repeating-linear-gradient(-45deg,#33FF74 0 12px,#340057 12px 24px)"></div>
  <div style="background:#FFFFFF;padding:24px;border-radius:0 0 18px 18px${opts.cardStyle ?? ''}">
${opts.body}
  </div>
  <p style="text-align:center;font-size:11px;color:#7A6A93;margin:16px 0 0">${opts.footer}</p>
</div></body></html>`;
}

/** The pink pill button the e-mails link with. */
export const pinkButton = (href: string, label: string): string =>
  `<a href="${href}" style="background:#FF3358;color:#FFFFFF;text-decoration:none;font-weight:700;padding:13px 24px;border-radius:999px;display:inline-block">${label}</a>`;
