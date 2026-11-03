/**
 * Escaping for text placed into the HTML (and XML) the API writes: e-mails,
 * the sandbox checkout page, the sitemap. Two variants on purpose, because the
 * output of each is part of what guests receive and must not drift.
 */

const BASIC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const STRICT: Record<string, string> = { ...BASIC, "'": '&#39;' };

/** & < > " escaped: element text and double-quoted attributes (e-mails, sitemap XML). */
export const escapeHtml = (s: string): string => s.replace(/[&<>"]/g, (c) => BASIC[c]);

/** Also escapes the single quote, for pages served by the API itself. */
export const escapeHtmlStrict = (s: string): string => s.replace(/[&<>"']/g, (c) => STRICT[c]);
