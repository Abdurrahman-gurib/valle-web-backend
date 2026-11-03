import { groupBy, settingsMap } from '../common/collections';
import { entrySettings } from '../bookings/pricing';
import type {
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
  Product,
  Restaurant,
  RestaurantGalleryImage,
  Setting,
  TeamPack,
  TeamPackItem,
  VipItem,
} from '../entities';
import type { ActivityDto, CatalogDto, CatKey, GalleryDto, PackTierDto, PinDto, ProductDto } from './catalog.types';

/**
 * Pure assembly of the catalog: database rows in, the exact shape of
 * database/seed/data.json out. One function per section, in output order.
 */

/** Every table the catalog reads, in the order CatalogService queries them. */
export interface CatalogRows {
  categories: Category[];
  experiences: Experience[];
  facts: ExperienceFact[];
  galleries: ExperienceGallery[];
  shots: GalleryShot[];
  pins: MapPin[];
  restaurants: Restaurant[];
  restaurantImages: RestaurantGalleryImage[];
  menuGroups: MenuGroup[];
  menuItems: MenuItem[];
  packageTiers: PackageTier[];
  packageTierItems: PackageTierItem[];
  packageAddons: PackageAddon[];
  vipItems: VipItem[];
  combos: Combo[];
  comboItems: ComboItem[];
  cinematicItems: CinematicItem[];
  priceList: PriceListEntry[];
  photoTiers: PhotoTier[];
  photoAddons: PhotoAddon[];
  teamPacks: TeamPack[];
  teamPackItems: TeamPackItem[];
  heroSlides: HeroSlide[];
  settings: Setting[];
  /** Active products only. */
  products: Product[];
}

/** Seed order of the categories record. */
const CAT_ORDER = ['adventure', 'nature', 'kids', 'tours'];

const catRank = (id: string): number => {
  const i = CAT_ORDER.indexOf(id);
  return i === -1 ? CAT_ORDER.length : i;
};

/** "G, M ,S" -> ['G', 'M', 'S']: allergen codes stored comma-separated. */
const codes = (s: string | null | undefined): string[] => (s ?? '').split(',').map((c) => c.trim()).filter(Boolean);

export function mapCategories(categories: Category[]): CatalogDto['CAT'] {
  const CAT: CatalogDto['CAT'] = {};
  for (const c of [...categories].sort((a, b) => catRank(a.id) - catRank(b.id))) {
    CAT[c.id] = { name: c.name, badge: c.badge, color: c.color, fg: c.fg, pulse: c.pulse };
  }
  return CAT;
}

export function mapActivities(experiences: Experience[], facts: ExperienceFact[]): ActivityDto[] {
  const factsByExp = groupBy(facts, (f) => f.experienceId);
  return experiences.map((e) => ({
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
}

export function mapPins(pins: MapPin[]): PinDto[] {
  return pins.map((p) => ({
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
}

export function mapRestaurants(
  restaurants: Restaurant[],
  restaurantImages: RestaurantGalleryImage[],
  menuGroups: MenuGroup[],
  menuItems: MenuItem[],
): CatalogDto['RESTOS'] {
  const imagesByResto = groupBy(restaurantImages, (g) => g.restaurantId);
  const groupsByResto = groupBy(menuGroups, (g) => g.restaurantId);
  const itemsByGroup = groupBy(menuItems, (i) => i.groupId);
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
          ...(codes(i.allergens).length ? { allergens: codes(i.allergens) } : {}),
        })),
        ...(g.note ? { note: g.note } : {}),
        ...(codes(g.noteAllergens).length ? { noteAllergens: codes(g.noteAllergens) } : {}),
      })),
    };
  }
  return RESTOS;
}

/** What the booking engine can charge besides experiences. */
export function mapProducts(products: Product[]): ProductDto[] {
  return products.map((p) => ({
    key: p.key, family: p.family, name: p.name, mode: p.mode, rr: p.priceRr, nr: p.priceNr, dblRr: p.dblRr, dblNr: p.dblNr, rateOnly: p.rateOnly, image: p.image, note: p.note,
    ...(p.wasPrice != null ? { was: p.wasPrice } : {}),
    ...(p.contents?.length ? { contents: p.contents } : {}),
    ...(p.validFrom ? { validFrom: String(p.validFrom).slice(0, 10) } : {}),
    ...(p.validTo ? { validTo: String(p.validTo).slice(0, 10) } : {}),
  }));
}

export function mapPacks(
  packageTiers: PackageTier[],
  packageTierItems: PackageTierItem[],
  packageAddons: PackageAddon[],
  vipItems: VipItem[],
): CatalogDto['PACKS'] {
  const tierItemsByTier = groupBy(packageTierItems, (i) => i.tierId);
  const mapTier = (t: PackageTier): PackTierDto => ({
    key: 'pkg:' + t.family + ':' + t.sortOrder,
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
  const family = (f: string) => packageTiers.filter((t) => t.family === f).map(mapTier);
  return {
    ls: family('ls'),
    ex: family('ex'),
    diamond: family('diamond'),
    resident: family('resident'),
    senior: family('senior'),
    addons: packageAddons.map((a) => ({ t: a.text, p: a.priceLabel })),
    vip: vipItems.map((v) => ({ t: v.text })),
  };
}

/** Key order follows seed insertion order of the shots, then of the galleries. */
export function mapGalleries(galleries: ExperienceGallery[], shots: GalleryShot[]): CatalogDto['GAL'] {
  const galleriesByExp = new Map(galleries.map((g) => [g.experienceId, g]));
  const shotsByExp = groupBy(shots, (s) => s.experienceId);
  const keyOrder: string[] = [];
  for (const s of shots) {
    if (!keyOrder.includes(s.experienceId)) keyOrder.push(s.experienceId);
  }
  for (const g of galleries) {
    if (!keyOrder.includes(g.experienceId)) keyOrder.push(g.experienceId);
  }
  const GAL: CatalogDto['GAL'] = {};
  for (const key of keyOrder) {
    const g = galleriesByExp.get(key);
    if (!g) continue;
    const gShots = [...(shotsByExp.get(key) ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
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
      ...(g.video ? { video: { src: g.video, poster: g.videoPoster ?? gShots[0]?.src ?? '' } } : {}),
    };
    GAL[key] = gal;
  }
  return GAL;
}

export function mapCombos(combos: Combo[], comboItems: ComboItem[]): CatalogDto['COMBO'] {
  const itemsByCombo = groupBy(comboItems, (i) => i.comboId);
  return combos.map((c) => ({
    key: 'combo:' + c.sortOrder,
    name: c.name,
    color: c.color,
    items: (itemsByCombo.get(c.id) ?? []).map((i) => ({ t: i.text })),
    rr: [c.rrSingle, c.rrDbl],
    nr: [c.nrSingle, c.nrDbl],
  }));
}

export function mapCinematic(items: CinematicItem[]): CatalogDto['CINE'] {
  return items.map((c) => ({ key: 'cine:' + c.sortOrder, n: c.name, p: c.price }));
}

/** Only rate-dependent experiences, in ACTS order. */
export function mapRatePrices(experiences: Experience[]): CatalogDto['RATEP'] {
  const RATEP: CatalogDto['RATEP'] = {};
  for (const e of experiences) {
    if (e.priceRr != null) RATEP[e.id] = [e.priceRr, e.priceNr ?? e.priceRr];
  }
  return RATEP;
}

/** Grouped by group_key, groups in seed insertion order. */
export function mapPriceList(priceList: PriceListEntry[]): CatalogDto['PL'] {
  const PL: CatalogDto['PL'] = {};
  for (const row of priceList) {
    if (!PL[row.groupKey]) PL[row.groupKey] = [];
    PL[row.groupKey].push({ n: row.label, rr: row.rr, nr: row.nr });
  }
  return PL;
}

export function mapPhoto(photoTiers: PhotoTier[], photoAddons: PhotoAddon[]): CatalogDto['PHOTO'] {
  const forRate = (rate: 'rr' | 'nr') => ({
    tiers: photoTiers.filter((t) => t.rate === rate).map((t) => ({
      key: 'photo:' + t.rate + ':' + t.sortOrder,
      name: t.name,
      color: t.color,
      act: t.activitiesLabel,
      single: t.singleLabel,
      dbl: t.dblLabel,
    })),
    addons: photoAddons.filter((a) => a.rate === rate).map((a) => ({ t: a.text, p: a.priceLabel })),
  });
  return { rr: forRate('rr'), nr: forRate('nr') };
}

export function mapTeam(teamPacks: TeamPack[], teamPackItems: TeamPackItem[]): CatalogDto['TEAM'] {
  const itemsByPack = groupBy(teamPackItems, (i) => i.teamPackId);
  return teamPacks.map((p) => ({
    img: p.image,
    items: (itemsByPack.get(p.id) ?? []).map((i) => ({ t: i.text })),
  }));
}

export function assembleCatalog(rows: CatalogRows): CatalogDto {
  const entry = entrySettings(settingsMap(rows.settings));
  return {
    CAT: mapCategories(rows.categories),
    ACTS: mapActivities(rows.experiences, rows.facts),
    PINS: mapPins(rows.pins),
    RESTOS: mapRestaurants(rows.restaurants, rows.restaurantImages, rows.menuGroups, rows.menuItems),
    PRODUCTS: mapProducts(rows.products),
    PACKS: mapPacks(rows.packageTiers, rows.packageTierItems, rows.packageAddons, rows.vipItems),
    GAL: mapGalleries(rows.galleries, rows.shots),
    COMBO: mapCombos(rows.combos, rows.comboItems),
    CINE: mapCinematic(rows.cinematicItems),
    RATEP: mapRatePrices(rows.experiences),
    PL: mapPriceList(rows.priceList),
    PHOTO: mapPhoto(rows.photoTiers, rows.photoAddons),
    TEAM: mapTeam(rows.teamPacks, rows.teamPackItems),
    HERO: rows.heroSlides.map((h) => h.src),
    ENTRY_A: entry.entryAdult,
    ENTRY_C: entry.entryChild,
  };
}
