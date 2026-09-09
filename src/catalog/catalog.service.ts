import { Injectable, NotFoundException } from '@nestjs/common';
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
} from '../entities';
import {
  ActivityDto,
  CatalogDto,
  CatKey,
  GalleryDto,
  PackTierDto,
  PinDto,
  RestaurantDto,
} from './catalog.types';

/** Seed order of the categories record. */
const CAT_ORDER = ['adventure', 'nature', 'kids', 'tours'];

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
    const out: Record<string, string> = {};
    for (const row of rows) out[row.key] = row.value;
    return out;
  }

  // ---------------------------------------------------------------- assembly

  private async buildCatalog(): Promise<CatalogDto> {
    const ds = this.dataSource;
    const [
      categories,
      experiences,
      facts,
      galleries,
      shots,
      pins,
      restaurants,
      restaurantImages,
      menuGroups,
      menuItems,
      packageTiers,
      packageTierItems,
      packageAddons,
      vipItems,
      combos,
      comboItems,
      cinematicItems,
      priceList,
      photoTiers,
      photoAddons,
      teamPacks,
      teamPackItems,
      heroSlides,
      settings,
    ] = await Promise.all([
      ds.getRepository(Category).find(),
      ds.getRepository(Experience).find({ order: { sortOrder: 'ASC' } }),
      ds.getRepository(ExperienceFact).find({ order: { sortOrder: 'ASC' } }),
      ds.getRepository(ExperienceGallery).find(),
      // id ascending == seed insertion order (drives GAL key order too)
      ds.getRepository(GalleryShot).find({ order: { id: 'ASC' } }),
      ds.getRepository(MapPin).find({ order: { sortOrder: 'ASC' } }),
      ds.getRepository(Restaurant).find({ order: { sortOrder: 'ASC' } }),
      ds
        .getRepository(RestaurantGalleryImage)
        .find({ order: { restaurantId: 'ASC', sortOrder: 'ASC' } }),
      ds
        .getRepository(MenuGroup)
        .find({ order: { restaurantId: 'ASC', sortOrder: 'ASC' } }),
      ds
        .getRepository(MenuItem)
        .find({ order: { groupId: 'ASC', sortOrder: 'ASC' } }),
      ds.getRepository(PackageTier).find({ order: { sortOrder: 'ASC' } }),
      ds
        .getRepository(PackageTierItem)
        .find({ order: { tierId: 'ASC', sortOrder: 'ASC' } }),
      ds.getRepository(PackageAddon).find({ order: { sortOrder: 'ASC' } }),
      ds.getRepository(VipItem).find({ order: { sortOrder: 'ASC' } }),
      ds.getRepository(Combo).find({ order: { sortOrder: 'ASC' } }),
      ds
        .getRepository(ComboItem)
        .find({ order: { comboId: 'ASC', sortOrder: 'ASC' } }),
      ds.getRepository(CinematicItem).find({ order: { sortOrder: 'ASC' } }),
      // id ascending == seed insertion order (preserves group order:
      // admission, zipline, quad, buggy, luge, bicycle, nepalese, peak, private, group)
      ds.getRepository(PriceListEntry).find({ order: { id: 'ASC' } }),
      ds.getRepository(PhotoTier).find({ order: { sortOrder: 'ASC' } }),
      ds.getRepository(PhotoAddon).find({ order: { sortOrder: 'ASC' } }),
      ds.getRepository(TeamPack).find({ order: { sortOrder: 'ASC' } }),
      ds
        .getRepository(TeamPackItem)
        .find({ order: { teamPackId: 'ASC', sortOrder: 'ASC' } }),
      ds.getRepository(HeroSlide).find({ order: { sortOrder: 'ASC' } }),
      ds.getRepository(Setting).find(),
    ]);

    // ---- CAT
    const CAT: CatalogDto['CAT'] = {};
    const orderedCategories = [...categories].sort(
      (a, b) => this.catRank(a.id) - this.catRank(b.id),
    );
    for (const c of orderedCategories) {
      CAT[c.id] = {
        name: c.name,
        badge: c.badge,
        color: c.color,
        fg: c.fg,
        pulse: c.pulse,
      };
    }

    // ---- ACTS
    const factsByExp = this.groupBy(facts, (f) => f.experienceId);
    const ACTS: ActivityDto[] = experiences.map((e) => ({
      id: e.id,
      name: e.name,
      cat: e.categoryId as CatKey,
      thrill: e.thrill,
      dur: e.durationLabel,
      age: e.ageLabel,
      price: e.basePrice,
      mode: e.priceMode,
      ...(e.flatLabel != null ? { flatLabel: e.flatLabel } : {}),
      img: e.image,
      blurb: e.blurb,
      ...(e.detail != null ? { detail: e.detail } : {}),
      gtk: (factsByExp.get(e.id) ?? []).map((f) => ({ t: f.text })),
    }));

    // ---- PINS
    const PINS: PinDto[] = pins.map((p) => ({
      n: p.code,
      px: Number(p.px),
      py: Number(p.py),
      kind: p.kind,
      name: p.name,
      sub: p.sub ?? null,
      img: p.image,
      ...(p.btnLabel != null ? { btnLabel: p.btnLabel } : {}),
      act: p.experienceId ?? null,
      ...(p.goTarget != null ? { go: p.goTarget } : {}),
    }));

    // ---- RESTOS
    const imagesByResto = this.groupBy(restaurantImages, (g) => g.restaurantId);
    const groupsByResto = this.groupBy(menuGroups, (g) => g.restaurantId);
    const itemsByGroup = this.groupBy(menuItems, (i) => i.groupId);
    const RESTOS: CatalogDto['RESTOS'] = {};
    for (const r of restaurants) {
      RESTOS[r.id] = {
        name: r.name,
        badge: r.badge,
        img: r.image,
        tag: r.tag,
        cuisine: r.cuisine,
        hours: r.hoursLabel,
        price: r.priceLabel,
        setting: r.settingLabel,
        about: r.about,
        detail: r.detail,
        menuPdf: r.menuPdf,
        gallery: (imagesByResto.get(r.id) ?? []).map((g) => g.src),
        menuGroups: (groupsByResto.get(r.id) ?? []).map((g) => ({
          title: g.title,
          items: (itemsByGroup.get(g.id) ?? []).map((i) => ({
            n: i.name,
            note: i.note,
            p: i.priceLabel,
          })),
        })),
      };
    }

    // ---- PACKS
    const tierItemsByTier = this.groupBy(packageTierItems, (i) => i.tierId);
    const mapTier = (t: PackageTier): PackTierDto => ({
      name: t.name,
      ...(t.badge != null ? { badge: t.badge } : {}),
      color: t.color,
      ...(t.fg != null ? { fg: t.fg } : {}),
      img: t.image,
      single: t.singleLabel,
      dbl: t.dblLabel,
      ...(t.note != null ? { note: t.note } : {}),
      ...(t.hero != null ? { hero: t.hero } : {}),
      items: (tierItemsByTier.get(t.id) ?? []).map((i) => ({ t: i.text })),
    });
    const PACKS: CatalogDto['PACKS'] = {
      ls: packageTiers.filter((t) => t.family === 'ls').map(mapTier),
      ex: packageTiers.filter((t) => t.family === 'ex').map(mapTier),
      addons: packageAddons.map((a) => ({ t: a.text, p: a.priceLabel })),
      vip: vipItems.map((v) => ({ t: v.text })),
    };

    // ---- GAL (key order follows seed insertion order of the shots)
    const galleriesByExp = new Map(galleries.map((g) => [g.experienceId, g]));
    const shotsByExp = this.groupBy(shots, (s) => s.experienceId);
    const GAL: CatalogDto['GAL'] = {};
    const galKeyOrder: string[] = [];
    for (const s of shots) {
      if (!galKeyOrder.includes(s.experienceId)) galKeyOrder.push(s.experienceId);
    }
    for (const g of galleries) {
      if (!galKeyOrder.includes(g.experienceId)) galKeyOrder.push(g.experienceId);
    }
    for (const key of galKeyOrder) {
      const g = galleriesByExp.get(key);
      if (!g) continue;
      const gShots = [...(shotsByExp.get(key) ?? [])].sort(
        (a, b) => a.sortOrder - b.sortOrder,
      );
      const gal: GalleryDto = {
        eyebrow: g.eyebrow,
        t1: g.t1,
        t2: g.t2,
        copy: g.copy,
        foot: g.foot,
        cta: g.cta,
        shots: gShots.map((s) => ({
          src: s.src,
          tag: s.tag,
          cap: s.cap,
          ...(s.pos != null ? { pos: s.pos } : {}),
        })),
      };
      GAL[key] = gal;
    }

    // ---- COMBO
    const comboItemsByCombo = this.groupBy(comboItems, (i) => i.comboId);
    const COMBO: CatalogDto['COMBO'] = combos.map((c) => ({
      name: c.name,
      color: c.color,
      items: (comboItemsByCombo.get(c.id) ?? []).map((i) => ({ t: i.text })),
      rr: [c.rrSingle, c.rrDbl] as [number, number],
      nr: [c.nrSingle, c.nrDbl] as [number, number],
    }));

    // ---- CINE
    const CINE: CatalogDto['CINE'] = cinematicItems.map((c) => ({
      n: c.name,
      p: c.price,
    }));

    // ---- RATEP (only rate-dependent experiences, in ACTS order)
    const RATEP: CatalogDto['RATEP'] = {};
    for (const e of experiences) {
      if (e.priceRr != null) {
        RATEP[e.id] = [e.priceRr, e.priceNr ?? e.priceRr];
      }
    }

    // ---- PL (grouped by group_key, groups in seed insertion order)
    const PL: CatalogDto['PL'] = {};
    for (const row of priceList) {
      if (!PL[row.groupKey]) PL[row.groupKey] = [];
      PL[row.groupKey].push({ n: row.label, rr: row.rr, nr: row.nr });
    }

    // ---- PHOTO
    const mapPhotoTier = (t: PhotoTier) => ({
      name: t.name,
      color: t.color,
      act: t.activitiesLabel,
      single: t.singleLabel,
      dbl: t.dblLabel,
    });
    const mapPhotoAddon = (a: PhotoAddon) => ({ t: a.text, p: a.priceLabel });
    const PHOTO: CatalogDto['PHOTO'] = {
      rr: {
        tiers: photoTiers.filter((t) => t.rate === 'rr').map(mapPhotoTier),
        addons: photoAddons.filter((a) => a.rate === 'rr').map(mapPhotoAddon),
      },
      nr: {
        tiers: photoTiers.filter((t) => t.rate === 'nr').map(mapPhotoTier),
        addons: photoAddons.filter((a) => a.rate === 'nr').map(mapPhotoAddon),
      },
    };

    // ---- TEAM
    const teamItemsByPack = this.groupBy(teamPackItems, (i) => i.teamPackId);
    const TEAM: CatalogDto['TEAM'] = teamPacks.map((p) => ({
      img: p.image,
      items: (teamItemsByPack.get(p.id) ?? []).map((i) => ({ t: i.text })),
    }));

    // ---- HERO / settings
    const HERO = heroSlides.map((h) => h.src);
    const settingsMap = new Map(settings.map((s) => [s.key, s.value]));
    const ENTRY_A = parseInt(settingsMap.get('entry_adult') ?? '500', 10);
    const ENTRY_C = parseInt(settingsMap.get('entry_child') ?? '250', 10);

    return {
      CAT,
      ACTS,
      PINS,
      RESTOS,
      PACKS,
      GAL,
      COMBO,
      CINE,
      RATEP,
      PL,
      PHOTO,
      TEAM,
      HERO,
      ENTRY_A,
      ENTRY_C,
    };
  }

  private catRank(id: string): number {
    const i = CAT_ORDER.indexOf(id);
    return i === -1 ? CAT_ORDER.length : i;
  }

  private groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
    const map = new Map<K, T[]>();
    for (const row of rows) {
      const k = key(row);
      const bucket = map.get(k);
      if (bucket) bucket.push(row);
      else map.set(k, [row]);
    }
    return map;
  }
}
