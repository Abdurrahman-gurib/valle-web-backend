import { SeoService, localizePath } from './seo.service';

const repo = (rows: unknown[]) => ({ find: jest.fn().mockResolvedValue(rows) }) as never;
const d = new Date('2026-09-20T10:00:00Z');

describe('localizePath', () => {
  it('prefixes non-English languages the way the site routes them', () => {
    expect(localizePath('/', 'fr')).toBe('/fr');
    expect(localizePath('/explore?cat=kids', 'de')).toBe('/de/explore?cat=kids');
    expect(localizePath('/activities/zipline', 'it')).toBe('/it/activities/zipline');
    expect(localizePath('/booking', 'en')).toBe('/booking');
    expect(localizePath('/packages', 'ar')).toBe('/ar/packages');
  });
});

describe('SeoService.sitemapXml', () => {
  it('lists every page in the eight languages with hreflang alternates and x-default', async () => {
    const svc = new SeoService(
      repo([{ id: 'zipline', updatedAt: d }]),
      repo([{ id: 'chamouze', updatedAt: d }]),
      repo([{ updatedAt: d }]),
      repo([{ updatedAt: d }]),
      repo([]),
    );
    const xml = await svc.sitemapXml('https://example.test');
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    for (const loc of ['https://example.test/activities/zipline', 'https://example.test/fr/activities/zipline', 'https://example.test/de/activities/zipline', 'https://example.test/it/activities/zipline', 'https://example.test/ar/activities/zipline', 'https://example.test/fr']) {
      expect(xml).toContain(`<loc>${loc}</loc>`);
    }
    expect(xml).toContain('<xhtml:link rel="alternate" hreflang="x-default" href="https://example.test/activities/zipline"/>');
    const urls = xml.match(/<url>/g)!.length;
    expect(urls % 8).toBe(0);
    expect(xml).toContain('<xhtml:link rel="alternate" hreflang="ru" href="https://example.test/ru/activities/zipline"/>');
  });
});
