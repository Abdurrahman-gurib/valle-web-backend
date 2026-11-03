import { Injectable, NotFoundException } from '@nestjs/common';
import { settingsMap } from '../common/collections';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  Category,
  CinematicItem,
  Combo,
  ComboItem,
  Experience,
  ExperienceFact,
  ExperienceGallery,
  GalleryShot,
  HeroSlide,
  MapPin,
  MenuGroup,
  MenuItem,
  PackageAddon,
  PackageTier,
  PackageTierItem,
  PhotoAddon,
  PhotoTier,
  PriceListEntry,
  Restaurant,
  RestaurantGalleryImage,
  Setting,
  TeamPack,
  TeamPackItem,
  VipItem,
  Product,
} from '../entities';
import { assembleCatalog, type CatalogRows } from './catalog.mappers';
import type { ActivityDto, CatalogDto, RestaurantDto } from './catalog.types';

const CACHE_TTL_MS = 60_000;

@Injectable()
export class CatalogService {
  private cache: { at: number; data: CatalogDto } | null = null;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async getCatalog(): Promise<CatalogDto> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) {
      return this.cache.data;
    }
    const data = await this.buildCatalog();
    this.cache = { at: Date.now(), data };
    return data;
  }

  async getExperiences(): Promise<ActivityDto[]> {
    return (await this.getCatalog()).ACTS;
  }

  async getExperience(id: string): Promise<ActivityDto> {
    const act = (await this.getCatalog()).ACTS.find((a) => a.id === id);
    if (!act) throw new NotFoundException(`Experience "${id}" not found`);
    return act;
  }

  async getRestaurants(): Promise<Record<string, RestaurantDto>> {
    return (await this.getCatalog()).RESTOS;
  }

  async getRestaurant(id: string): Promise<RestaurantDto> {
    const resto = (await this.getCatalog()).RESTOS[id];
    if (!resto) throw new NotFoundException(`Restaurant "${id}" not found`);
    return resto;
  }

  async getSettings(): Promise<Record<string, string>> {
    const rows = await this.dataSource.getRepository(Setting).find();
    return Object.fromEntries(settingsMap(rows));
  }

  // ---------------------------------------------------------------- assembly

  private async buildCatalog(): Promise<CatalogDto> {
    return assembleCatalog(await this.loadRows());
  }

  private async loadRows(): Promise<CatalogRows> {
    const ds = this.dataSource;
    const [
      categories, experiences, facts, galleries, shots, pins, restaurants, restaurantImages, menuGroups, menuItems,
      packageTiers, packageTierItems, packageAddons, vipItems, combos, comboItems, cinematicItems, priceList,
      photoTiers, photoAddons, teamPacks, teamPackItems, heroSlides, settings,
    ] = await Promise.all([
      ds.getRepository(Category).find(),
      ds.getRepository(Experience).find({ order: { sortOrder: 'ASC' } }),
      ds.getRepository(ExperienceFact).find({ order: { sortOrder: 'ASC' } }),
      ds.getRepository(ExperienceGallery).find(),
      // id ascending == seed insertion order (drives GAL key order too)
      ds.getRepository(GalleryShot).find({ order: { id: 'ASC' } }),
      ds.getRepository(MapPin).find({ order: { sortOrder: 'ASC' } }),
      ds.getRepository(Restaurant).find({ order: { sortOrder: 'ASC' } }),
      ds.getRepository(RestaurantGalleryImage).find({ order: { restaurantId: 'ASC', sortOrder: 'ASC' } }),
      ds.getRepository(MenuGroup).find({ order: { restaurantId: 'ASC', sortOrder: 'ASC' } }),
      ds.getRepository(MenuItem).find({ order: { groupId: 'ASC', sortOrder: 'ASC' } }),
      ds.getRepository(PackageTier).find({ order: { sortOrder: 'ASC' } }),
      ds.getRepository(PackageTierItem).find({ order: { tierId: 'ASC', sortOrder: 'ASC' } }),
      ds.getRepository(PackageAddon).find({ order: { sortOrder: 'ASC' } }),
      ds.getRepository(VipItem).find({ order: { sortOrder: 'ASC' } }),
      ds.getRepository(Combo).find({ order: { sortOrder: 'ASC' } }),
      ds.getRepository(ComboItem).find({ order: { comboId: 'ASC', sortOrder: 'ASC' } }),
      ds.getRepository(CinematicItem).find({ order: { sortOrder: 'ASC' } }),
      // id ascending == seed insertion order (preserves group order:
      // admission, zipline, quad, buggy, luge, bicycle, nepalese, peak, private, group)
      ds.getRepository(PriceListEntry).find({ order: { id: 'ASC' } }),
      ds.getRepository(PhotoTier).find({ order: { sortOrder: 'ASC' } }),
      ds.getRepository(PhotoAddon).find({ order: { sortOrder: 'ASC' } }),
      ds.getRepository(TeamPack).find({ order: { sortOrder: 'ASC' } }),
      ds.getRepository(TeamPackItem).find({ order: { teamPackId: 'ASC', sortOrder: 'ASC' } }),
      ds.getRepository(HeroSlide).find({ order: { sortOrder: 'ASC' } }),
      ds.getRepository(Setting).find(),
    ]);
    const products = await ds.getRepository(Product).find({ where: { active: true }, order: { sortOrder: 'ASC' } });
    return {
      categories, experiences, facts, galleries, shots, pins, restaurants, restaurantImages, menuGroups, menuItems,
      packageTiers, packageTierItems, packageAddons, vipItems, combos, comboItems, cinematicItems, priceList,
      photoTiers, photoAddons, teamPacks, teamPackItems, heroSlides, settings, products,
    };
  }
}
