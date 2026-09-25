import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Experience, JobVacancy, PackageTier, PriceListEntry, Restaurant } from '../entities';
import { SeoController } from './seo.controller';
import { SeoService } from './seo.service';

/** sitemap.xml and robots.txt, served through nginx at the site root. */
@Module({
  imports: [TypeOrmModule.forFeature([Experience, Restaurant, PackageTier, PriceListEntry, JobVacancy])],
  controllers: [SeoController],
  providers: [SeoService],
})
export class SeoModule {}
