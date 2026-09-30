import PDFDocument from 'pdfkit';
import type { Booking, Waiver } from '../entities';
import { TERMS, type TermsLang } from './terms';
import { ageOn } from './waiver-rules';

const PURPLE = '#340057';
const VIOLET = '#7333FF';
const GREY = '#6B5B85';

/**
 * PDF copy of a signed Disclaimer Form: what the guest gets by e-mail and
 * WhatsApp, and what the gate can print. The clauses appear in the language
 * the guest read them in; Arabic falls back to the binding English text
 * because the PDF fonts cannot shape Arabic script (the e-mail body carries
 * the Arabic wording).
 */
export function pdfLang(lang: string): TermsLang {
  return lang === 'fr' || lang === 'de' || lang === 'it' ? lang : 'en';
}

const fmtDate = (v: string | Date): string => {
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};

export function renderWaiverPdf(w: Waiver, b: Booking, opts: { siteUrl: string }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const lang = pdfLang(w.lang);
    const T = TERMS[lang];
    const L = T.labels;
    const doc = new PDFDocument({ size: 'A4', margins: { top: 48, bottom: 48, left: 52, right: 52 }, info: { Title: `Disclaimer Form ${b.refCode} · ${w.participantName}`, Author: 'Mare Anguilles Farms Ltd' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const signedAt = w.signedAt instanceof Date ? w.signedAt : new Date(w.signedAt);
    const stamp = `${signedAt.toLocaleString('en-GB', { timeZone: 'Indian/Mauritius', hour12: false })} (Mauritius) · IP ${w.ip || '-'} · ${w.termsVersion} · ${w.lang.toUpperCase()}`;

    // header
    doc.font('Helvetica-BoldOblique').fontSize(24).fillColor(PURPLE).text('VALLÉ', { continued: true }).font('Helvetica').fontSize(9).fillColor(GREY).text('  ADVENATURE™ PARK');
    doc.moveDown(0.6);
    doc.font('Helvetica').fontSize(8).fillColor(GREY).text(stamp);
    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').fontSize(16).fillColor(PURPLE).text(L.title, { align: 'center' });
    doc.font('Helvetica').fontSize(9).fillColor(PURPLE).text(L.company, { align: 'center' });
    doc.moveDown(0.8);

    // participant block first, as on the paper form's summary
    const row = (label: string, value: string) => {
      if (!value) return;
      doc.font('Helvetica-Bold').fontSize(8).fillColor(VIOLET).text(label.toUpperCase());
      doc.font('Helvetica').fontSize(10.5).fillColor(PURPLE).text(value);
      doc.moveDown(0.35);
    };
    doc.font('Helvetica-Bold').fontSize(11).fillColor(PURPLE).text(`${L.participant.toUpperCase()} · ${b.refCode}`);
    doc.moveDown(0.4);
    const visit = fmtDate(b.visitDate);
    row(L.name, w.participantName);
    const age = ageOn(String(w.birthDate).slice(0, 10), String(b.visitDate).slice(0, 10));
    row(L.birth, `${fmtDate(w.birthDate)}  ·  ${L.age.replace('{n}', String(age))}${w.isMinor ? '  ·  ' + L.underGuardian : ''}`);;
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
    row('Visit', `${visit} · ${b.slot}`);
    doc.moveDown(0.4);

    // clauses
    doc.font('Helvetica').fontSize(9.5).fillColor(PURPLE).text(L.intro);
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').text(L.hereby);
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(9.2);
    T.clauses.forEach((c, i) => {
      doc.text(`${i + 1}.  ${c}`, { indent: 0, paragraphGap: 4, lineGap: 1 });
    });
    doc.moveDown(0.6);

    // confirmations
    doc.font('Helvetica-Bold').fontSize(10).text(L.confirmations.toUpperCase());
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(9.2);
    for (const k of ['c_terms', 'c_health', 'c_consent'] as const) doc.text(`[x]  ${L[k]}`, { paragraphGap: 3 });
    doc.text(`[${w.marketingConsent ? 'x' : ' '}]  ${L.marketing}`, { paragraphGap: 3 });
    doc.moveDown(0.8);

    // signature
    if (doc.y > doc.page.height - 200) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(10).fillColor(PURPLE).text((w.isMinor ? L.sigGuardian : L.sigParticipant).toUpperCase());
    doc.moveDown(0.3);
    if (w.signaturePng) {
      try {
        doc.image(Buffer.from(w.signaturePng.replace(/^data:image\/png;base64,/, ''), 'base64'), { fit: [240, 90] });
      } catch {
        doc.font('Helvetica').fontSize(9).text('[signature image unavailable]');
      }
    } else {
      // sample / preview: an empty signature line
      const y = doc.y + 60;
      doc.moveTo(doc.x, y).lineTo(doc.x + 240, y).strokeColor(GREY).stroke();
      doc.y = y + 6;
    }
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(9.5).text(`${w.signedBy}  ·  ${fmtDate(signedAt)}`);
    doc.moveDown(1);
    doc.font('Helvetica').fontSize(8).fillColor(GREY).text(`${opts.siteUrl}  ·  B102, Mare Anguilles, Chamouny, Mauritius  ·  +230 660 44 77`, { align: 'center' });

    doc.end();
  });
}
