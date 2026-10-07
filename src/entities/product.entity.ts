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
}

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
