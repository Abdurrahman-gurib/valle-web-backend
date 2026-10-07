import { existsSync } from 'node:fs';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import type { Booking, Waiver } from '../entities';
import { TERMS, type TermsLang } from './terms';
import { rtlParagraph } from './rtl-text';
import { ageOn } from './waiver-rules';

const PURPLE = '#340057';
const VIOLET = '#7333FF';
const GREY = '#6B5B85';
const VISIT: Record<TermsLang, string> = { en: 'Visit', fr: 'Visite', de: 'Besuch', it: 'Visita', ar: 'الزيارة', ru: 'Визит', es: 'Visita', hi: 'यात्रा' };

/** Noto Naskh Arabic, shipped in assets/fonts (SIL OFL); Helvetica cannot draw Arabic. */
const FONT_DIR = join(process.cwd(), 'assets', 'fonts');
const AR_REGULAR = join(FONT_DIR, 'NotoNaskhArabic-Regular.ttf');
const AR_BOLD = join(FONT_DIR, 'NotoNaskhArabic-Bold.ttf');
export const arabicFontsAvailable = (): boolean => existsSync(AR_REGULAR) && existsSync(AR_BOLD);
/** Noto Sans (Latin + Cyrillic subset) for Russian: Helvetica has no Cyrillic glyphs. */
const RU_REGULAR = join(FONT_DIR, 'NotoSans-Regular.ttf');
const RU_BOLD = join(FONT_DIR, 'NotoSans-Bold.ttf');
export const cyrillicFontsAvailable = (): boolean => existsSync(RU_REGULAR) && existsSync(RU_BOLD);
/** Noto Sans Devanagari for Hindi; fontkit shapes the conjuncts and matras. */
const HI_REGULAR = join(FONT_DIR, 'NotoSansDevanagari-Regular.ttf');
const HI_BOLD = join(FONT_DIR, 'NotoSansDevanagari-Bold.ttf');
export const devanagariFontsAvailable = (): boolean => existsSync(HI_REGULAR) && existsSync(HI_BOLD);

/**
 * PDF copy of a signed Disclaimer Form: what the guest gets by e-mail and
 * WhatsApp, and what the gate can print. The clauses appear in the language
 * the guest read them in; Arabic is laid out right to left with an embedded
 * Arabic font (falls back to the binding English text if the font files are
 * missing on the server).
 */
export function pdfLang(lang: string): TermsLang {
  if (lang === 'ar') return arabicFontsAvailable() ? 'ar' : 'en';
  if (lang === 'ru') return cyrillicFontsAvailable() ? 'ru' : 'en';
  if (lang === 'hi') return devanagariFontsAvailable() ? 'hi' : 'en';
  return lang === 'fr' || lang === 'de' || lang === 'it' || lang === 'es' ? lang : 'en';
}

const fmtDate = (v: string | Date): string => {
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};

export function renderWaiverPdf(w: Waiver, b: Booking, opts: { siteUrl: string }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const lang = pdfLang(w.lang);
    const rtl = lang === 'ar';
    const T = TERMS[lang];
    const L = T.labels;
    const doc = new PDFDocument({ size: 'A4', margins: { top: 48, bottom: 48, left: 52, right: 52 }, info: { Title: `Disclaimer Form ${b.refCode} · ${w.participantName}`, Author: 'Mare Anguilles Farms Ltd' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    if (rtl) {
      doc.registerFont('Body', AR_REGULAR);
      doc.registerFont('Bold', AR_BOLD);
    } else if (lang === 'ru') {
      doc.registerFont('Body', RU_REGULAR);
      doc.registerFont('Bold', RU_BOLD);
    } else if (lang === 'hi') {
      doc.registerFont('Body', HI_REGULAR);
      doc.registerFont('Bold', HI_BOLD);
    } else {
      doc.registerFont('Body', 'Helvetica');
      doc.registerFont('Bold', 'Helvetica-Bold');
    }

    const W = doc.page.width;
    const M = doc.page.margins.left;
    const CW = W - 2 * M;
    const signedAt = w.signedAt instanceof Date ? w.signedAt : new Date(w.signedAt);
    const stamp = `${signedAt.toLocaleString('en-GB', { timeZone: 'Indian/Mauritius', hour12: false })} (Mauritius) · IP ${w.ip || '-'} · ${w.termsVersion} · ${w.lang.toUpperCase()}`;

    /** A paragraph in the reading direction of the form. */
    const para = (text: string, o: { size?: number; bold?: boolean; color?: string; gap?: number; prefix?: string; lineGap?: number } = {}) => {
      doc.font(o.bold ? 'Bold' : 'Body').fontSize(o.size ?? 9.2).fillColor(o.color ?? PURPLE);
      if (rtl) rtlParagraph(doc, text, { x: M, width: CW, paragraphGap: o.gap ?? 4, prefix: o.prefix, lineGap: o.lineGap ?? 1 });
      else doc.text((o.prefix ? o.prefix + '  ' : '') + text, M, doc.y, { width: CW, paragraphGap: o.gap ?? 4, lineGap: o.lineGap ?? 1 });
    };

    // header band in the site's colours, drawn at fixed positions so nothing overlaps
    doc.save();
    doc.rect(0, 0, W, 84).fill(PURPLE);
    doc.rect(0, 84, W, 8).fill(PURPLE);
    for (let x = -24; x < W + 24; x += 24) doc.polygon([x, 92], [x + 12, 92], [x + 24, 84], [x + 12, 84]).fill('#33FF74');
    doc.restore();
    doc.font('Helvetica-BoldOblique').fontSize(26).fillColor('#FFFFFF').text('VALLÉ', M, 22, { lineBreak: false });
    doc.font('Helvetica').fontSize(8).fillColor('#FFFFFF').opacity(0.8).text('ADVENATURE™ PARK', M + 2, 54, { characterSpacing: 2, lineBreak: false }).opacity(1);
    if (rtl) {
      doc.y = 18;
      doc.font('Bold').fontSize(15).fillColor('#FFFFFF');
      rtlParagraph(doc, L.title, { x: M + 120, width: CW - 120, paragraphGap: 2 });
      doc.font('Body').fontSize(8.5).fillColor('#FFFFFF').opacity(0.85);
      rtlParagraph(doc, L.company, { x: M + 120, width: CW - 120 });
      doc.opacity(1);
    } else {
      doc.font('Bold').fontSize(16).fillColor('#FFFFFF').text(L.title, M, 26, { width: CW, align: 'right', lineBreak: false });
      doc.font('Body').fontSize(8.5).fillColor('#FFFFFF').opacity(0.85).text(L.company, M, 50, { width: CW, align: 'right', lineBreak: false }).opacity(1);
    }
    doc.font('Helvetica').fontSize(8).fillColor(GREY).text(stamp, M, 104, { width: CW, lineBreak: false });
    doc.y = 124;
    doc.x = M;

    // participant block first, as on the paper form's summary
    const row = (label: string, value: string) => {
      if (!value) return;
      para(label.toUpperCase(), { size: 8, bold: true, color: VIOLET, gap: 0 });
      para(value, { size: 10.5, gap: 5 });
    };
    para(`${L.participant.toUpperCase()} · ${b.refCode}`, { size: 11, bold: true, gap: 6 });
    const visit = fmtDate(b.visitDate);
    const age = ageOn(String(w.birthDate).slice(0, 10), String(b.visitDate).slice(0, 10));
    row(L.name, w.participantName);
    row(L.birth, `${fmtDate(w.birthDate)}  ·  ${L.age.replace('{n}', String(age))}${w.isMinor ? '  ·  ' + L.underGuardian : ''}`);
    row(`${L.height} / ${L.weight}`, `${w.heightCm} cm · ${w.weightKg} kg`);
    if (w.isMinor) row(L.guardian, w.guardianName);
    row(L.address, w.address);
    row(L.email, w.email);
    row(L.phone, w.phone);
    row(L.nationality, w.nationality);
    row(L.idNumber, w.idNumber);
    row(L.emName, w.emergencyName);
    row(L.emPhone, w.emergencyPhone);
    row(L.medical, w.medicalNotes);
    if (w.groupParticipants && w.groupParticipants.length) row(`Signed as leader for ${w.groupParticipants.length}`, w.groupParticipants.join(', '));
    row(VISIT[lang], `${visit} · ${b.slot}`);
    doc.y += 6;

    // clauses
    para(L.intro, { size: 9.5, gap: 6 });
    para(L.hereby, { size: 9.5, bold: true, gap: 4 });
    T.clauses.forEach((c, i) => para(c, { prefix: `${i + 1}.`, gap: 4 }));
    doc.y += 6;

    // confirmations
    para(L.confirmations.toUpperCase(), { size: 10, bold: true, gap: 3 });
    for (const k of ['c_terms', 'c_health', 'c_consent'] as const) para(L[k], { prefix: '[x]', gap: 3 });
    para(L.marketing, { prefix: w.marketingConsent ? '[x]' : '[ ]', gap: 3 });
    doc.y += 8;

    // signature
    if (doc.y > doc.page.height - 200) doc.addPage();
    para((w.isMinor ? L.sigGuardian : L.sigParticipant).toUpperCase(), { size: 10, bold: true, gap: 4 });
    const sigX = rtl ? M + CW - 240 : M;
    if (w.signaturePng) {
      try {
        doc.image(Buffer.from(w.signaturePng.replace(/^data:image\/png;base64,/, ''), 'base64'), sigX, doc.y, { fit: [240, 90] });
        doc.y += 96;
      } catch {
        para('[signature image unavailable]', { size: 9 });
      }
    } else {
      // sample / preview: an empty signature line
      const y = doc.y + 60;
      doc.moveTo(sigX, y).lineTo(sigX + 240, y).strokeColor(GREY).stroke();
      doc.y = y + 6;
    }
    para(`${w.signedBy}  ·  ${fmtDate(signedAt)}`, { size: 9.5, gap: 10 });
    doc.font('Helvetica').fontSize(8).fillColor(GREY).text(`${opts.siteUrl}  ·  B102, Mare Anguilles, Chamouny, Mauritius  ·  +230 660 44 77`, M, doc.y, { width: CW, align: 'center' });

    doc.end();
  });
}
