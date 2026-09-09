import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'photo_tiers' })
export class PhotoTier {
  @PrimaryGeneratedColumn({ name: 'id' })
  id: number;

  @Column({ name: 'rate', type: 'text' })
  rate: 'rr' | 'nr';

  @Column({ name: 'name', type: 'text' })
  name: string;

  @Column({ name: 'color', type: 'text' })
  color: string;

  @Column({ name: 'activities_label', type: 'text' })
  activitiesLabel: string;

  @Column({ name: 'single_label', type: 'text' })
  singleLabel: string;

  @Column({ name: 'dbl_label', type: 'text' })
  dblLabel: string;

  @Column({ name: 'sort_order', type: 'int' })
  sortOrder: number;
}
