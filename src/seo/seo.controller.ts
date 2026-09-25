import { Controller, Get, Header, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SeoService } from './seo.service';

/**
 * The public origin the sitemap should name. SITE_URL wins (set it to the
 * canonical https://vallepark.com once the domain is live); otherwise it is
 * derived from the request, which nginx forwards with the original scheme.
 */
function siteUrl(req: Request): string {
  const env = (process.env.SITE_URL ?? '').trim().replace(/\/+$/, '');
  if (env) return env;
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0].trim() || req.protocol || 'https';
  const host = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0].trim() || req.headers.host || 'vallepark.com';
  return `${proto}://${host}`;
}

@ApiTags('seo')
@Controller()
export class SeoController {
  constructor(private readonly seo: SeoService) {}

  @Get('sitemap.xml')
  @ApiOperation({ summary: 'XML sitemap of the canonical public pages, with lastmod from the content tables' })
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  sitemap(@Req() req: Request): Promise<string> {
    return this.seo.sitemapXml(siteUrl(req));
  }

  @Get('robots.txt')
  @ApiOperation({ summary: 'robots.txt with the sitemap location' })
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  robots(@Req() req: Request): string {
    return this.seo.robotsTxt(siteUrl(req));
  }
}
