import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'package_tier_items' })
export class PackageTierItem {
  @PrimaryGeneratedColumn({ name: 'id' })
  id: number;

  @Column({ name: 'tier_id', type: 'int' })
  tierId: number;

  @Column({ name: 'text', type: 'text' })
  text: string;

  @Column({ name: 'sort_order', type: 'int' })
  sortOrder: number;
}
