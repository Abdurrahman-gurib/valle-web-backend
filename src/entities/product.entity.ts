import { Column, Entity, PrimaryColumn } from 'typeorm';

export type ProductMode = 'pp' | 'pair' | 'flat';

/**
 * A bookable product that is not an experience: a package tier, a combo, the
 * VIP day, a photo tier or a cinematic item. Priced per person (pp), per
 * single / double (pair) or per unit (flat); see migration 013.
 */
@Entity({ name: 'products' })
export class Product {
  /** pkg:<family>:<n> | combo:<n> | cine:<n> | photo:<rate>:<n> | vip */
  @PrimaryColumn({ name: 'key', type: 'text' })
  key: string;

  @Column({ name: 'family', type: 'text' })
  family: string;

  @Column({ name: 'name', type: 'text' })
  name: string;

  @Column({ name: 'mode', type: 'text' })
  mode: ProductMode;

  @Column({ name: 'price_rr', type: 'int' })
  priceRr: number;

  @Column({ name: 'price_nr', type: 'int' })
  priceNr: number;

  @Column({ name: 'dbl_rr', type: 'int', nullable: true })
  dblRr: number | null;

  @Column({ name: 'dbl_nr', type: 'int', nullable: true })
  dblNr: number | null;

  @Column({ name: 'rate_only', type: 'text', nullable: true })
  rateOnly: 'rr' | 'nr' | null;

  @Column({ name: 'image', type: 'text', default: '' })
  image: string;

  @Column({ name: 'note', type: 'text', default: '' })
  note: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'active', type: 'boolean', default: true })
  active: boolean;

  /** Struck-through "was" price per person (deals); null when the product is not a deal. */
  @Column({ name: 'was_price', type: 'int', nullable: true })
  wasPrice: number | null;

  /** What the product includes, in display order (deals); null = not listed. */
  @Column({ name: 'contents', type: 'text', array: true, nullable: true })
  contents: string[] | null;

  /** First / last visit date (YYYY-MM-DD, inclusive) the product can be booked for; null = open. */
  @Column({ name: 'valid_from', type: 'date', nullable: true })
  validFrom: string | null;

  @Column({ name: 'valid_to', type: 'date', nullable: true })
  validTo: string | null;
}

/** Families whose price already includes park entry: the booking charges no entry line. */
export const ENTRY_INCLUDED_FAMILIES = new Set(['student', 'expo']);

/** Whether a product can be booked for a visit date (YYYY-MM-DD); open-ended when the bounds are null. */
export const productValidOn = (p: Pick<Product, 'validFrom' | 'validTo'>, visitDate: string): boolean =>
  (!p.validFrom || visitDate >= String(p.validFrom).slice(0, 10)) && (!p.validTo || visitDate <= String(p.validTo).slice(0, 10));

export const PRODUCT_PREFIX = 'product:';
export const isProductId = (id: string): boolean => id.startsWith(PRODUCT_PREFIX);
export const productKeyOf = (id: string): string => id.slice(PRODUCT_PREFIX.length);

/** What a product costs for a party, by its mode. */
export function productAmount(p: Pick<Product, 'mode' | 'priceRr' | 'priceNr' | 'dblRr' | 'dblNr'>, rate: 'rr' | 'nr', adults: number, kids: number, units: number): number {
  const single = rate === 'nr' ? p.priceNr : p.priceRr;
  const dbl = rate === 'nr' ? p.dblNr : p.dblRr;
  if (p.mode === 'flat') return single * units;
  const persons = adults + kids;
  if (p.mode === 'pp' || dbl == null) return single * persons;
  return Math.floor(persons / 2) * dbl + (persons % 2) * single;
}
