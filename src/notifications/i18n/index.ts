import { escapeHtml } from '../../common/html';
import { PARK_TZ } from '../../common/park-time';
import { ar } from './ar';
import { de } from './de';
import { en, type GuestCatalogue, type GuestKey } from './en';
import { es } from './es';
import { fr } from './fr';
import { hi } from './hi';
import { it } from './it';
import { ru } from './ru';

export type { GuestCatalogue, GuestKey } from './en';

/** The site's languages (Frontend/src/i18n); a booking keeps the one it was made in. */
export const GUEST_LANGS = ['en', 'fr', 'de', 'it', 'ar', 'ru', 'es', 'hi'] as const;
export type GuestLang = (typeof GUEST_LANGS)[number];

export const CATALOGUES: Record<GuestLang, GuestCatalogue> = { en, fr, de, it, ar, ru, es, hi };

/** A stored language, or English when it is missing or not one of ours. */
export const guestLang = (v: unknown): GuestLang =>
  (typeof v === 'string' && (GUEST_LANGS as readonly string[]).includes(v) ? v : 'en') as GuestLang;

/**
 * Intl locales: dates read like the guest's language (en-GB keeps "Friday, 2 October 2026");
 * numbers keep Western digits in Arabic and Hindi so amounts match the receipt and the gate.
 */
const DATE_LOCALE: Record<GuestLang, string> = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', ar: 'ar-u-nu-latn', ru: 'ru-RU', es: 'es-ES', hi: 'hi-IN-u-nu-latn' };
const NUMBER_LOCALE: Record<GuestLang, string> = { en: 'en-US', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', ar: 'ar-u-nu-latn', ru: 'ru-RU', es: 'es-ES', hi: 'hi-IN-u-nu-latn' };

type Vars = Record<string, string | number>;

const fill = (template: string, vars: Vars | undefined, wrap: (s: string) => string): string =>
  vars ? template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? wrap(String(vars[k])) : m)) : template;

/** One message in `lang` with its {placeholders} filled in (plain text: WhatsApp, text e-mail, PDF). */
export function t(lang: GuestLang, key: GuestKey, vars?: Vars): string {
  return fill(CATALOGUES[lang][key] ?? en[key], vars, (s) => s);
}

/** The same for HTML: the values are escaped, the catalogue's own markup (<strong>) is kept. */
export function th(lang: GuestLang, key: GuestKey, vars?: Vars): string {
  return fill(CATALOGUES[lang][key] ?? en[key], vars, escapeHtml);
}

type PluralBase<K extends string> = K extends `${infer B}_other` ? B : never;
export type PluralKey = PluralBase<GuestKey>;

/** The plural form of `base` for n (CLDR categories; zero falls back to other). */
export function plural(lang: GuestLang, base: PluralKey, n: number, vars: Vars = {}, html = false): string {
  const cat = new Intl.PluralRules(NUMBER_LOCALE[lang]).select(n);
  const key = (`${base}_${cat}` in en ? `${base}_${cat}` : `${base}_other`) as GuestKey;
  return (html ? th : t)(lang, key, { n, ...vars });
}

/** "Friday, 2 October 2026" / "vendredi 2 octobre 2026" for a YYYY-MM-DD day, in park time. */
export function dateIn(day: string, lang: GuestLang): string {
  return new Date(day + 'T12:00:00Z').toLocaleDateString(DATE_LOCALE[lang], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: PARK_TZ });
}

/** "Rs 12,500" with the language's digit grouping ("Rs 12 500" in French). */
export const moneyIn = (n: number, lang: GuestLang): string => 'Rs ' + n.toLocaleString(NUMBER_LOCALE[lang]);

export const isRtl = (lang: GuestLang): boolean => lang === 'ar';

/** E-mail font stacks: Arial for Latin and Cyrillic; script-capable faces first for Arabic and Hindi. */
export const emailFont = (lang: GuestLang): string =>
  lang === 'ar' ? "Tahoma,'Segoe UI','Noto Naskh Arabic','Noto Sans Arabic',Arial,sans-serif"
    : lang === 'hi' ? "'Nirmala UI','Noto Sans Devanagari',Mangal,'Segoe UI',Arial,sans-serif"
      : 'Arial,Helvetica,sans-serif';
