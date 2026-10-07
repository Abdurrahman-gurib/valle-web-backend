// Response shapes: mirror Database/seed/data.json and Frontend/src/types.ts exactly.

export type CatKey = 'adventure' | 'nature' | 'kids' | 'tours';
export type PriceMode = 'pp' | 'flat' | 'entry' | 'kiosk';
export type RateKey = 'rr' | 'nr';

export interface CategoryDto {
  name: string;
  badge: string;
  color: string;
  fg: string;
  pulse: string;
}

export interface ActivityDto {
  id: string;
  name: string;
  cat: CatKey;
  thrill: number;
  dur: string;
  age: string;
  price: number;
  mode: PriceMode;
  flatLabel?: string;
  img: string;
  blurb: string;
  detail?: string;
  gtk: { t: string }[];
}

export interface PinDto {
  n: string;
  px: number;
  py: number;
  kind: 'main' | 'sub';
  name: string;
  sub: string | null;
  img: string;
  btnLabel?: string;
  act: string | null;
  go?: string;
}

export interface MenuItemDto {
  n: string;
  note: string;
  p: string;
}

export interface MenuGroupDto {
  title: string;
  items: MenuItemDto[];
}

export interface RestaurantDto {
  name: string;
  badge: string;
  img: string;
  tag: string;
  cuisine: string;
  hours: string;
  price: string;
  setting: string;
  about: string;
  detail: string;
  menuPdf: string;
  gallery: string[];
  menuGroups: MenuGroupDto[];
}

export interface PackItemDto {
  t: string;
}

export interface PackTierDto {
  /** Bookable product key (products table); absent when the tier is not sold online. */
  key?: string;
  name: string;
  badge?: string;
  color: string;
  fg?: string;
  img: string;
  single: string;
  dbl: string;
  note?: string;
  hero?: string;
  items: PackItemDto[];
}

export interface PacksDto {
  ls: PackTierDto[];
  ex: PackTierDto[];
  diamond: PackTierDto[];
  resident: PackTierDto[];
  senior: PackTierDto[];
  addons: { t: string; p: string }[];
  vip: PackItemDto[];
}

export interface GalleryShotDto {
  src: string;
  tag: string;
  cap: string;
  pos?: string;
}

export interface GalleryDto {
  eyebrow: string;
  t1: string;
  t2: string;
  copy: string;
  foot: string;
  cta: string;
  shots: GalleryShotDto[];
}

export interface ComboDto {
  key?: string;
  name: string;
  color: string;
  items: PackItemDto[];
  rr: [number, number];
  nr: [number, number];
}

export interface CineItemDto {
  key?: string;
  n: string;
  p: number;
}

export interface PriceRowDto {
  n: string;
  rr: number;
  nr: number;
}

export interface PhotoTierDto {
  key?: string;
  name: string;
  color: string;
  act: string;
  single: string;
  dbl: string;
}

export interface PhotoRateDto {
  tiers: PhotoTierDto[];
  addons: { t: string; p: string }[];
}

export interface TeamPackDto {
  img: string;
  items: PackItemDto[];
}

/** A product the booking engine can charge (packages, combos, VIP, photo tiers, cinematic). */
export interface ProductDto {
  key: string;
  family: string;
  name: string;
  mode: 'pp' | 'pair' | 'flat';
  rr: number;
  nr: number;
  dblRr: number | null;
  dblNr: number | null;
  rateOnly: 'rr' | 'nr' | null;
  image: string;
  note: string;
}

export interface CatalogDto {
  PRODUCTS: ProductDto[];
  CAT: Record<string, CategoryDto>;
  ACTS: ActivityDto[];
  PINS: PinDto[];
  RESTOS: Record<string, RestaurantDto>;
  PACKS: PacksDto;
  GAL: Record<string, GalleryDto>;
  COMBO: ComboDto[];
  CINE: CineItemDto[];
  RATEP: Record<string, [number, number]>;
  PL: Record<string, PriceRowDto[]>;
  PHOTO: Record<RateKey, PhotoRateDto>;
  TEAM: TeamPackDto[];
  HERO: string[];
  ENTRY_A: number;
  ENTRY_C: number;
}
