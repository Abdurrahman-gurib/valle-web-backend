import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Experience, JobVacancy, PackageTier, PriceListEntry, Restaurant } from '../entities';

/** One <url> entry of the sitemap. */
export interface SitemapUrl {
  path: string;
  lastmod: Date;
  changefreq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  priority: number;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Languages of the public site; English at the root, the others under /fr, /de, /it. */
export const SITE_LANGS = ['en', 'fr', 'de', 'it', 'ar'] as const;
type SiteLang = (typeof SITE_LANGS)[number];

/** '/explore?cat=kids' -> '/fr/explore?cat=kids'; '/' -> '/fr'. Mirrors the frontend's localizePath. */
export function localizePath(path: string, lang: SiteLang): string {
  if (lang === 'en') return path;
  if (path === '/') return '/' + lang;
  if (path.startsWith('/?') || path.startsWith('/#')) return '/' + lang + path.slice(1);
  return '/' + lang + path;
}
const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const latest = (...dates: (Date | null | undefined)[]) =>
  dates.reduce<Date>((m, d) => (d && d > m ? d : m), new Date(0));

/**
 * Search-engine plumbing: the sitemap and robots.txt for the public site.
 * Only canonical public pages are listed; the back office, the booking flow
 * and every experience that redirects elsewhere stay out.
 */
@Injectable()
export class SeoService {
  constructor(
    @InjectRepository(Experience) private readonly experienceRepo: Repository<Experience>,
    @InjectRepository(Restaurant) private readonly restaurantRepo: Repository<Restaurant>,
    @InjectRepository(PackageTier) private readonly tierRepo: Repository<PackageTier>,
    @InjectRepository(PriceListEntry) private readonly priceRepo: Repository<PriceListEntry>,
    @InjectRepository(JobVacancy) private readonly vacancyRepo: Repository<JobVacancy>,
  ) {}

  async urls(): Promise<SitemapUrl[]> {
    const [experiences, restaurants, tiers, prices, vacancies] = await Promise.all([
      this.experienceRepo.find({ order: { sortOrder: 'ASC' } }),
      this.restaurantRepo.find(),
      this.tierRepo.find(),
      this.priceRepo.find(),
      this.vacancyRepo.find({ where: { status: 'published' }, order: { updatedAt: 'DESC' } }),
    ]);
    const expMod = latest(...experiences.map((e) => e.updatedAt));
    const priceMod = latest(...prices.map((p) => p.updatedAt));
    const tierMod = latest(...tiers.map((t) => t.updatedAt));
    const restoMod = latest(...restaurants.map((r) => r.updatedAt));
    const vacMod = latest(...vacancies.map((v) => v.updatedAt));

    const out: SitemapUrl[] = [
      { path: '/', lastmod: latest(expMod, priceMod, tierMod, restoMod), changefreq: 'weekly', priority: 1.0 },
      { path: '/explore', lastmod: expMod, changefreq: 'weekly', priority: 0.9 },
      ...['adventure', 'nature', 'kids', 'tours'].map((c) => ({ path: `/explore?cat=${c}`, lastmod: expMod, changefreq: 'weekly' as const, priority: 0.7 })),
      ...experiences.map((e) => ({ path: `/activities/${e.id}`, lastmod: latest(e.updatedAt, priceMod), changefreq: 'monthly' as const, priority: 0.8 })),
      { path: '/packages', lastmod: latest(tierMod, priceMod), changefreq: 'monthly', priority: 0.9 },
      ...restaurants.map((r) => ({ path: `/dine/${r.id}`, lastmod: r.updatedAt, changefreq: 'monthly' as const, priority: 0.7 })),
      { path: '/booking', lastmod: priceMod, changefreq: 'monthly', priority: 0.6 },
      { path: '/vacancies', lastmod: vacMod.getTime() ? vacMod : new Date(), changefreq: 'weekly', priority: 0.5 },
      ...vacancies.map((v) => ({ path: `/vacancies/${v.slug}`, lastmod: v.updatedAt, changefreq: 'weekly' as const, priority: 0.5 })),
    ];
    return out;
  }

  /**
   * One <url> per page per language (/explore, /fr/explore, /de/explore,
   * /it/explore), each listing all its language versions as hreflang
   * alternates with English as x-default, as Google documents for
   * multilingual sites.
   */
  async sitemapXml(siteUrl: string): Promise<string> {
    const urls = await this.urls();
    const body = urls
      .flatMap((u) => SITE_LANGS.map((lang) => {
        const alternates = [...SITE_LANGS, 'x-default' as const]
          .map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${escapeXml(siteUrl + localizePath(u.path, l === 'x-default' ? 'en' : l))}"/>`)
          .join('\n');
        const priority = lang === 'en' ? u.priority : Math.max(0.1, u.priority - 0.1);
        return `  <url>\n    <loc>${escapeXml(siteUrl + localizePath(u.path, lang))}</loc>\n    <lastmod>${iso(u.lastmod)}</lastmod>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${priority.toFixed(1)}</priority>\n${alternates}\n  </url>`;
      }))
      .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${body}\n</urlset>\n`;
  }

  /**
   * robots.txt is a crawl hint, not access control: the back office is
   * protected by its own authentication regardless of what is listed here.
   */
  robotsTxt(siteUrl: string): string {
    return [
      'User-agent: *',
      'Allow: /',
      'Disallow: /staff',
      'Disallow: /hr',
      'Disallow: /api/',
      'Disallow: /*?q=',
      '',
      `Sitemap: ${siteUrl}/sitemap.xml`,
      '',
    ].join('\n');
  }
}
