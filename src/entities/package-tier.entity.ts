import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'package_tiers' })
export class PackageTier {
  @PrimaryGeneratedColumn({ name: 'id' })
  id: number;

  /** ls (Light/Standard) | ex (Exclusive tiers) */
  @Column({ name: 'family', type: 'text' })
  family: 'ls' | 'ex' | 'diamond' | 'resident' | 'senior';

  @Column({ name: 'name', type: 'text' })
  name: string;

  @Column({ name: 'badge', type: 'text', nullable: true })
  badge: string | null;

  @Column({ name: 'color', type: 'text' })
  color: string;

  @Column({ name: 'fg', type: 'text', nullable: true })
  fg: string | null;

  @Column({ name: 'image', type: 'text' })
  image: string;

  /** e.g. 'Rs 11,100' */
  @Column({ name: 'single_label', type: 'text' })
  singleLabel: string;

  @Column({ name: 'dbl_label', type: 'text' })
  dblLabel: string;

  @Column({ name: 'note', type: 'text', nullable: true })
  note: string | null;

  @Column({ name: 'hero', type: 'text', nullable: true })
  hero: string | null;

  @Column({ name: 'sort_order', type: 'int' })
  sortOrder: number;

  /** Bumped by a database trigger on every UPDATE; feeds the sitemap's lastmod. */
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
