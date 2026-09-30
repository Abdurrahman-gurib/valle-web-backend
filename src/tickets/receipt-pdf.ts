import PDFDocument from 'pdfkit';
import type { Booking, BookingLine } from '../entities';

const PURPLE = '#340057';
const VIOLET = '#7333FF';
const GREY = '#6B5B85';
const rs = (n: number) => 'Rs ' + Math.round(n).toLocaleString('en-US');
const fmtDate = (v: string | Date | null): string => {
  if (!v) return '';
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};
const METHOD: Record<string, string> = { cash: 'Cash', card: 'Card', juice: 'Juice (MCB)', online: 'Online', other: 'Other' };
const KIND: Record<string, string> = { foc: 'FOC pass', percent: 'Discount', amount: 'Discount', entry_free: 'Free park entry', none: '' };

/**
 * A receipt in the VALLÉ template: what was booked, the Explorer Pass
 * discount, any FOC / coupon adjustment, what has been paid and what is left
 * to pay at the gate. Printed at the cashier and linked from the ticket.
 */
export function renderReceiptPdf(b: Booking, lines: BookingLine[], opts: { siteUrl: string }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A5', margins: { top: 40, bottom: 40, left: 36, right: 36 }, info: { Title: `Receipt ${b.refCode}`, Author: 'Mare Anguilles Farms Ltd' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width;
    const M = doc.page.margins.left;
    const CW = W - 2 * M;
    const paid = b.paidAmount ?? 0;
    const balance = Math.max(0, b.total - paid);

    // header band
    doc.save();
    doc.rect(0, 0, W, 72).fill(PURPLE);
    doc.rect(0, 72, W, 7).fill(PURPLE);
    for (let x = -24; x < W + 24; x += 24) doc.polygon([x, 79], [x + 12, 79], [x + 24, 72], [x + 12, 72]).fill('#33FF74');
    doc.restore();
    doc.font('Helvetica-BoldOblique').fontSize(22).fillColor('#FFFFFF').text('VALLÉ', M, 18, { lineBreak: false });
    doc.font('Helvetica').fontSize(7).fillColor('#FFFFFF').opacity(0.8).text('ADVENATURE™ PARK', M + 2, 46, { characterSpacing: 2, lineBreak: false }).opacity(1);
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#FFFFFF').text(balance > 0 ? 'BOOKING RECEIPT' : 'PAID RECEIPT', M, 20, { width: CW, align: 'right', lineBreak: false });
    doc.font('Helvetica').fontSize(8).fillColor('#FFFFFF').opacity(0.85).text('Mare Anguilles Farms Ltd · B102, Mare Anguilles, Chamouny', M, 42, { width: CW, align: 'right', lineBreak: false }).opacity(1);

    doc.y = 94;
    doc.x = M;
    const row = (label: string, value: string, bold = false) => {
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9.5).fillColor(PURPLE);
      doc.text(label, M, y, { width: CW * 0.68, lineBreak: false });
      doc.text(value, M + CW * 0.68, y, { width: CW * 0.32, align: 'right', lineBreak: false });
      doc.y = y + (bold ? 17 : 14);
    };
    const tag = (t: string) => { doc.font('Helvetica-Bold').fontSize(7.5).fillColor(VIOLET).text(t, M, doc.y, { width: CW }); doc.y += 2; };

    tag('BOOKING');
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#FF3358').text(b.refCode, M, doc.y);
    doc.font('Helvetica').fontSize(9.5).fillColor(PURPLE).text(`${b.guestName} · ${b.adults} adult${b.adults === 1 ? '' : 's'}${b.kids ? ` · ${b.kids} child${b.kids === 1 ? '' : 'ren'}` : ''} · ${b.rate === 'nr' ? 'visitor rate' : 'resident rate'}`, M, doc.y + 2);
    doc.text(`Visit ${fmtDate(b.visitDate)} · ${b.slot === 'morning' ? 'morning arrival' : 'afternoon arrival'}${b.status === 'postponed' ? ' · POSTPONED, new date to be chosen' : ''}${b.status === 'cancelled' ? ' · CANCELLED' : ''}`, M, doc.y + 2);
    doc.y += 12;

    tag('ITEMS');
    for (const l of lines) row(l.label, rs(l.amount));
    doc.moveTo(M, doc.y + 2).lineTo(M + CW, doc.y + 2).dash(2, { space: 2 }).strokeColor('#D9CCF2').stroke().undash();
    doc.y += 8;
    row('Subtotal', rs(b.subtotal));
    if (b.discount > 0) row('Explorer Pass discount (15%)', '− ' + rs(b.discount));
    if ((b.adjustmentAmount ?? 0) > 0) {
      const k = KIND[b.adjustmentKind] || 'Adjustment';
      const detail = b.adjustmentKind === 'percent' ? ` ${b.adjustmentValue}%` : '';
      row(`${k}${detail}${b.couponCode ? ` · code ${b.couponCode}` : ''}${b.adjustmentNote ? ` · ${b.adjustmentNote}` : ''}`, '− ' + rs(b.adjustmentAmount));
    }
    row('Total', rs(b.total), true);
    doc.y += 4;

    tag('PAYMENT');
    row(paid > 0 ? `Paid${b.paymentMethod ? ' · ' + (METHOD[b.paymentMethod] ?? b.paymentMethod) : ''}${b.paidAt ? ' · ' + fmtDate(b.paidAt) : ''}${b.receiptNo ? ' · receipt ' + b.receiptNo : ''}` : 'Paid', rs(paid));
    row(balance > 0 ? 'Balance to pay at the gate' : 'Balance', rs(balance), true);
    if (b.payMode === 'online' && paid === 0) { doc.font('Helvetica').fontSize(8.5).fillColor(GREY).text('Online payment pending.', M, doc.y); doc.y += 12; }
    doc.y += 10;

    doc.font('Helvetica').fontSize(8).fillColor(GREY).text('No refund on cancellation once booked and paid; rain or weather is not a ground for cancellation. A visit stopped by the park for weather is postponed to a date of your choice (Disclaimer Form, clause 12).', M, doc.y, { width: CW });
    doc.y += 6;
    doc.text(`${opts.siteUrl}  ·  +230 660 44 77  ·  sales@vallepark.com`, M, doc.y, { width: CW, align: 'center' });
    doc.end();
  });
}
