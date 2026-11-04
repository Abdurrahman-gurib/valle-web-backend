import { partyText, rupees } from '../common/money';
import { addDays, longDate } from '../common/park-time';
import type { Booking } from '../entities';

/**
 * Pure pieces of what guests receive: wording shared by the ticket, the
 * reminder, the waiver nudge and the photos message, and the branded e-mail
 * frame they all sit in. GuestMessagingService adds the links and sends.
 */

export const PARK_ADDRESS = 'B102, Mare Anguilles, Chamouny, Mauritius';
export const PARK_PHONE = '+230 660 4477';
export const MAPS = 'https://maps.google.com/?q=Vall%C3%A9+Advenature+Park+Chamouny';

export const slotLabel = (slot: string): string => (slot === 'morning' ? 'Morning arrival, 09:00 to 12:00' : 'Afternoon arrival, 12:00 to 15:30');

/** "2 adults and 1 child" */
export const party = (b: Booking): string => partyText(b.adults, b.kids, ' and ', b.infants ?? 0);

/** The first word of the booking name, or the whole name when it has none. */
export const firstName = (b: Booking): string => b.guestName.split(' ')[0] || b.guestName;

/**
 * What the guest still owes, from the payment actually recorded on the booking
 * (never from payMode: choosing "pay online" takes no money until a gateway exists).
 */
export function payLine(b: Booking): string {
  const paid = b.paidAmount ?? 0;
  if (paid >= b.total) return `${rupees(b.total)} paid`;
  if ((b.depositAmount ?? 0) > paid) return `${rupees(b.depositAmount - paid)} deposit due now, ${rupees(b.total - paid)} in all`;
  if (paid > 0) return `${rupees(paid)} paid, ${rupees(b.total - paid)} to pay on arrival`;
  return `${rupees(b.total)} to pay on arrival`;
}

/**
 * The waiver deadline as guests read it: the evening before the visit, or
 * "before you arrive" when the visit is tomorrow or today.
 */
export function waiverDeadline(visitDate: string, today: string): string {
  const eve = addDays(visitDate, -1);
  return eve > today ? `by ${longDate(eve)} evening` : 'before you arrive';
}

/**
 * The branded e-mail frame: purple header with the title, the green stripe,
 * the white card (`body` is its inner HTML, already escaped) and the footer line.
 */
export function emailFrame(opts: { title: string; titleSize: number; cardStyle?: string; body: string; footer: string }): string {
  return `<!doctype html><html><body style="margin:0;background:#F7F3FF;font-family:Arial,Helvetica,sans-serif;color:#340057">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
  <div style="background:#340057;color:#FFFFFF;border-radius:18px 18px 0 0;padding:22px 24px">
    <div style="font-size:11px;letter-spacing:.16em;opacity:.7">VALLÉ ADVENATURE™ PARK</div>
    <div style="font-size:${opts.titleSize}px;font-weight:900;font-style:italic;margin-top:6px">${opts.title}</div>
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
