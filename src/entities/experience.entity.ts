import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'experiences' })
export class Experience {
  /** zipline, quad, ... */
  @PrimaryColumn({ name: 'id', type: 'text' })
  id: string;

  @Column({ name: 'name', type: 'text' })
  name: string;

  @Column({ name: 'category_id', type: 'text' })
  categoryId: string;

  @Column({ name: 'thrill', type: 'int' })
  thrill: number;

  @Column({ name: 'duration_label', type: 'text' })
  durationLabel: string;

  @Column({ name: 'age_label', type: 'text' })
  ageLabel: string;

  /** "from" price (MUR); equals resident rate where rates differ */
  @Column({ name: 'base_price', type: 'int', default: 0 })
  basePrice: number;

  /** pp | flat | entry | kiosk */
  @Column({ name: 'price_mode', type: 'text' })
  priceMode: 'pp' | 'flat' | 'entry' | 'kiosk';

  @Column({ name: 'flat_label', type: 'text', nullable: true })
  flatLabel: string | null;

  @Column({ name: 'image', type: 'text' })
  image: string;

  @Column({ name: 'blurb', type: 'text' })
  blurb: string;

  @Column({ name: 'detail', type: 'text', nullable: true })
  detail: string | null;

  @Column({ name: 'price_rr', type: 'int', nullable: true })
  priceRr: number | null;

  @Column({ name: 'price_nr', type: 'int', nullable: true })
  priceNr: number | null;

  @Column({ name: 'sort_order', type: 'int' })
  sortOrder: number;

  /** Bumped by a database trigger on every UPDATE; feeds the sitemap's lastmod. */
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
