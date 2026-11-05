import { CATALOGUES, dateIn, GUEST_LANGS, guestLang, moneyIn, plural, t, th } from '.';
import { en } from './en';

const placeholders = (s: string): string[] => [...new Set(s.match(/\{\w+\}/g) ?? [])].sort();

describe('guest message catalogue', () => {
  it('has every key, with the same {placeholders} and markup, in every language', () => {
    const keys = Object.keys(en).sort();
    for (const lang of GUEST_LANGS) {
      const cat = CATALOGUES[lang] as Record<string, string>;
      expect(Object.keys(cat).sort()).toEqual(keys);
      for (const k of keys) {
        expect({ lang, k, ph: placeholders(cat[k]) }).toEqual({ lang, k, ph: placeholders((en as Record<string, string>)[k]) });
        expect({ lang, k, strong: cat[k].includes('<strong>') }).toEqual({ lang, k, strong: (en as Record<string, string>)[k].includes('<strong>') });
        expect(cat[k].trim()).not.toBe('');
      }
    }
  });

  it('falls back to English for unknown languages', () => {
    expect(guestLang('fr')).toBe('fr');
    expect(guestLang('xx')).toBe('en');
    expect(guestLang(null)).toBe('en');
  });

  it('formats dates and money per language', () => {
    expect(dateIn('2026-10-02', 'en')).toBe('Friday, 2 October 2026');
    expect(dateIn('2026-10-02', 'fr')).toBe('vendredi 2 octobre 2026');
    expect(dateIn('2026-10-02', 'de')).toBe('Freitag, 2. Oktober 2026');
    expect(dateIn('2026-10-02', 'ar')).toContain('2026');
    expect(dateIn('2026-10-02', 'ar')).toContain('الجمعة');
    expect(moneyIn(12500, 'en')).toBe('Rs 12,500');
    expect(moneyIn(12500, 'de')).toBe('Rs 12.500');
    expect(moneyIn(12500, 'ar')).toMatch(/^Rs 12.500$/);
  });

  it('picks plural forms by language', () => {
    expect(plural('en', 'kids', 1)).toBe('1 child');
    expect(plural('en', 'kids', 3)).toBe('3 children');
    expect(plural('ru', 'kids', 1)).toBe('1 ребёнок');
    expect(plural('ru', 'kids', 3)).toBe('3 ребёнка');
    expect(plural('ru', 'kids', 5)).toBe('5 детей');
    expect(plural('fr', 'adults', 2)).toBe('2 adultes');
  });

  it('fills placeholders, escaping them only for HTML', () => {
    expect(t('en', 'hiComma', { name: '<b>' })).toBe('Hi <b>,');
    expect(th('en', 'waiverLink_html1', { name: '<b>', date: 'D' })).toBe('Hi &lt;b&gt;, one thing before your visit on <strong>D</strong>:');
  });
});
