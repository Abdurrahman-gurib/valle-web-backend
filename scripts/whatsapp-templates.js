#!/usr/bin/env node
/**
 * Registers (or reports) the WhatsApp message templates the API sends:
 * the booking ticket, the evening-before reminder and the signed-waiver copy. Idempotent: a template
 * that already exists is only reported with its approval status.
 *
 *   D360_API_KEY=... SITE_URL=https://web-production-ff60b.up.railway.app node scripts/whatsapp-templates.js
 *   railway ssh --service api -- node scripts/whatsapp-templates.js      (uses the service variables)
 *
 * Meta reviews templates, usually within minutes to a few hours; until one is
 * APPROVED, sends with it fail and the ticket still goes by e-mail. The
 * "Open my ticket" button points at SITE_URL/ticket/{{1}}: if the site moves
 * to another domain, delete and re-run so the button follows.
 */
const KEY = (process.env.D360_API_KEY || '').trim();
const BASE = (process.env.D360_BASE_URL || 'https://waba-v2.360dialog.io').replace(/\/+$/, '');
const SITE = (process.env.SITE_URL || 'https://web-production-ff60b.up.railway.app').replace(/\/+$/, '');
const LANG = process.env.WA_TEMPLATE_LANG || 'en';
const TICKET = process.env.WA_TICKET_TEMPLATE || 'valle_booking_ticket';
const REMINDER = process.env.WA_REMINDER_TEMPLATE || 'valle_visit_reminder';
const WAIVER = process.env.WA_WAIVER_TEMPLATE || 'valle_waiver_copy';

if (!KEY) {
  console.error('D360_API_KEY is not set');
  process.exit(1);
}

const button = {
  type: 'BUTTONS',
  buttons: [{ type: 'URL', text: 'Open my ticket', url: `${SITE}/ticket/{{1}}`, example: [`${SITE}/ticket/VAL-1234-26?t=wu5ThRrFtCJ8XUm3_pBljxcT`] }],
};

const TEMPLATES = [
  {
    name: TICKET,
    category: 'UTILITY',
    language: LANG,
    components: [
      { type: 'HEADER', format: 'TEXT', text: 'Your VALLÉ ticket' },
      {
        type: 'BODY',
        text:
          'Hi {{1}}, your booking at VALLÉ Advenature Park is confirmed.\n\n' +
          'Reference: {{2}}\nVisit: {{3}}\nParty: {{4}}\nPayment: {{5}}\n\n' +
          'Open your ticket below and show the QR code at the gate. Need to change or cancel? Reply here or call +230 660 44 77.',
        example: { body_text: [['Asha', 'VAL-1234-26', 'Friday 2 October 2026, morning arrival 09:00 to 12:00', '2 adults and 1 child', 'Rs 6,200 to pay on arrival']] },
      },
      { type: 'FOOTER', text: 'B102, Mare Anguilles, Chamouny' },
      button,
    ],
  },
  {
    name: REMINDER,
    category: 'UTILITY',
    language: LANG,
    components: [
      {
        type: 'BODY',
        text:
          'See you tomorrow at VALLÉ Advenature Park, {{1}}.\n\n' +
          'Visit: {{2}}\nPayment: {{3}}\n\n' +
          'Bring closed shoes, sunscreen and water. Your ticket and QR code are one tap away below.',
        example: { body_text: [['Asha', 'Friday 2 October 2026, morning arrival 09:00 to 12:00', 'Rs 6,200 to pay on arrival']] },
      },
      { type: 'FOOTER', text: 'Questions? Reply here or call +230 660 44 77' },
      button,
    ],
  },
  {
    // Sent right after a guest signs the Disclaimer Form online: the PDF copy
    // as the header document, the ticket one tap away.
    name: WAIVER,
    category: 'UTILITY',
    language: LANG,
    components: [
      { type: 'HEADER', format: 'DOCUMENT', example: { header_handle: [`${SITE}/api/tickets/sample/waiver.pdf`] } },
      {
        type: 'BODY',
        text:
          'Thank you, the Disclaimer Form for {{1}} is signed (booking {{2}}).\n\n' +
          'Your copy is attached as a PDF. Keep it for your visit and show your ticket QR code at the gate.',
        example: { body_text: [['Asha Rahman', 'VAL-1234-26']] },
      },
      { type: 'FOOTER', text: 'Mare Anguilles Farms Ltd · VALLÉ Advenature Park' },
      button,
    ],
  },
];

async function api(path, init = {}) {
  const res = await fetch(BASE + path, { ...init, headers: { 'D360-API-KEY': KEY, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) throw Object.assign(new Error(`${res.status} ${typeof body === 'string' ? body : JSON.stringify(body)}`), { status: res.status });
  return body;
}

(async () => {
  const listed = await api('/v1/configs/templates');
  const existing = new Map(((listed && (listed.waba_templates || listed.data)) || []).map((t) => [`${t.name}/${t.language}`, t]));
  for (const t of TEMPLATES) {
    const have = existing.get(`${t.name}/${t.language}`);
    if (have) {
      console.log(`${t.name} (${t.language}): exists, status ${have.status}`);
      continue;
    }
    const created = await api('/v1/configs/templates', { method: 'POST', body: JSON.stringify(t) });
    console.log(`${t.name} (${t.language}): submitted, status ${created.status || 'PENDING'}`);
  }
})().catch((e) => {
  console.error('whatsapp-templates failed:', e.message);
  process.exit(1);
});
