import PDFDocument from 'pdfkit';
import { dayMonthYear } from '../common/park-time';
import type { Booking, BookingLine } from '../entities';
import { party } from '../notifications/guest-messages';
import { guestLang, moneyIn, t, type GuestKey, type GuestLang } from '../notifications/i18n';
import { rtlParagraph } from '../waivers/rtl-text';
import { pdfLang, registerFonts } from '../waivers/waiver-pdf';

const PURPLE = '#340057';
const VIOLET = '#7333FF';
const GREY = '#6B5B85';
const fmtDate = (v: string | Date | null): string => (v ? dayMonthYear(v) : '');
const METHOD: Record<string, GuestKey> = { cash: 'rc_cash', card: 'rc_card', juice: 'rc_juice', online: 'rc_online', other: 'rc_other' };
const KIND: Record<string, GuestKey | null> = { foc: 'rc_foc', percent: 'rc_discount', amount: 'rc_discount', entry_free: 'rc_entryFree', none: null };

/**
 * A receipt in the VALLÉ template: what was booked, the Explorer Pass
 * discount, any FOC / coupon adjustment, what has been paid and what is left
 * to pay at the gate. Linked from the ticket in the guest's language
 * (`opts.lang`, the booking's); printed at the cashier in English.
 * Arabic is laid out right to left, Arabic, Russian and Hindi use the embedded
 * Noto fonts (English when the font files are missing, like the waiver PDF).
 * Item labels are the English catalogue names.
 */
export function renderReceiptPdf(b: Booking, lines: BookingLine[], opts: { siteUrl: string; lang?: string | null }): Promise<Buffer> {
  const lang: GuestLang = guestLang(pdfLang(guestLang(opts.lang)));
  const rtl = lang === 'ar';
  const L = (key: GuestKey, vars?: Record<string, string | number>) => t(lang, key, vars);
  const rs = (n: number) => moneyIn(Math.round(n), lang);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A5', margins: { top: 40, bottom: 40, left: 36, right: 36 }, info: { Title: L('rc_docTitle', { ref: b.refCode }), Author: 'Mare Anguilles Farms Ltd' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    registerFonts(doc, lang);

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
    const title = L(balance > 0 ? 'rc_titleDue' : 'rc_titlePaid');
    if (rtl) {
      doc.font('Bold').fontSize(14).fillColor('#FFFFFF');
      doc.y = 16;
      rtlParagraph(doc, title, { x: M + 110, width: CW - 110 });
    } else {
      doc.font('Bold').fontSize(14).fillColor('#FFFFFF').text(title, M, 20, { width: CW, align: 'right', lineBreak: false });
    }
    doc.font('Helvetica').fontSize(8).fillColor('#FFFFFF').opacity(0.85).text('Mare Anguilles Farms Ltd · B102, Mare Anguilles, Chamouny', M, 42, { width: CW, align: 'right', lineBreak: false }).opacity(1);

    doc.y = 94;
    doc.x = M;
    /** A paragraph in the reading direction, from doc.y down. */
    const para = (text: string, o: { size: number; bold?: boolean; color?: string; align?: 'center'; gap?: number }) => {
      doc.font(o.bold ? 'Bold' : 'Body').fontSize(o.size).fillColor(o.color ?? PURPLE);
      if (rtl && !o.align) rtlParagraph(doc, text, { x: M, width: CW });
      else doc.text(text, M, doc.y + (o.gap ?? 0), { width: CW, ...(o.align ? { align: o.align } : {}) });
    };
    const row = (label: string, value: string, bold = false) => {
      const y = doc.y;
      doc.font(bold ? 'Bold' : 'Body').fontSize(bold ? 11 : 9.5).fillColor(PURPLE);
      if (rtl) {
        doc.text(value, M, y, { width: CW * 0.32, lineBreak: false });
        rtlParagraph(doc, label, { x: M + CW * 0.32, width: CW * 0.68 });
      } else {
        doc.text(label, M, y, { width: CW * 0.68, lineBreak: false });
        doc.text(value, M + CW * 0.68, y, { width: CW * 0.32, align: 'right', lineBreak: false });
      }
      doc.y = y + (bold ? 17 : 14);
    };
    const tag = (text: string) => {
      doc.font('Bold').fontSize(7.5).fillColor(VIOLET);
      if (rtl) rtlParagraph(doc, text, { x: M, width: CW });
      else doc.text(text, M, doc.y, { width: CW });
      doc.y += 2;
    };

    tag(L('rc_booking'));
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#FF3358').text(b.refCode, M, doc.y, rtl ? { width: CW, align: 'right' } : {});
    doc.y += 2;
    para(`${b.guestName} · ${party(b, lang, ' · ')} · ${L(b.rate === 'nr' ? 'rate_visitor' : 'rate_resident')}`, { size: 9.5 });
    const status = `${b.status === 'postponed' ? ' · ' + L('rc_postponed') : ''}${b.status === 'cancelled' ? ' · ' + L('rc_cancelled') : ''}`;
    para(`${L('rc_visit', { date: fmtDate(b.visitDate) })} · ${L(b.slot === 'morning' ? 'rc_morning' : 'rc_afternoon')}${status}`, { size: 9.5, gap: 2 });
    doc.y += 12;

    tag(L('rc_items'));
    for (const l of lines) row(l.label, rs(l.amount));
    doc.moveTo(M, doc.y + 2).lineTo(M + CW, doc.y + 2).dash(2, { space: 2 }).strokeColor('#D9CCF2').stroke().undash();
    doc.y += 8;
    row(L('rc_subtotal'), rs(b.subtotal));
    if (b.discount > 0) row(L('rc_explorer'), '− ' + rs(b.discount));
    if ((b.adjustmentAmount ?? 0) > 0) {
      const kind = KIND[b.adjustmentKind];
      const k = kind ? L(kind) : L('rc_adjustment');
      const detail = b.adjustmentKind === 'percent' ? ` ${b.adjustmentValue}%` : '';
      row(`${k}${detail}${b.couponCode ? ` · ${L('rc_code', { code: b.couponCode })}` : ''}${b.adjustmentNote ? ` · ${b.adjustmentNote}` : ''}`, '− ' + rs(b.adjustmentAmount));
    }
    row(L('rc_total'), rs(b.total), true);
    doc.y += 4;

    tag(L('rc_payment'));
    const method = b.paymentMethod ? (METHOD[b.paymentMethod] ? L(METHOD[b.paymentMethod]) : b.paymentMethod) : '';
    row(paid > 0 ? `${L('rc_paid')}${method ? ' · ' + method : ''}${b.paidAt ? ' · ' + fmtDate(b.paidAt) : ''}${b.receiptNo ? ' · ' + L('rc_receiptNo', { no: b.receiptNo }) : ''}` : L('rc_paid'), rs(paid));
    // paid more than the re-priced total (a code applied after payment): say so, never print "Balance Rs 0"
    const refundDue = Math.max(0, paid - b.total);
    if (refundDue > 0) row(L('rc_refund'), rs(refundDue), true);
    else row(L(balance > 0 ? 'rc_balanceDue' : 'rc_balance'), rs(balance), true);
    if (b.payMode === 'online' && paid === 0) { para(L('rc_onlinePending'), { size: 8.5, color: GREY }); doc.y += 12; }
    doc.y += 10;

    para(L('rc_terms'), { size: 8, color: GREY });
    doc.y += 6;
    doc.font('Helvetica').fontSize(8).fillColor(GREY).text(`${opts.siteUrl}  ·  +230 660 4477  ·  sales@vallepark.com`, M, doc.y, { width: CW, align: 'center' });
    doc.end();
  });
}
