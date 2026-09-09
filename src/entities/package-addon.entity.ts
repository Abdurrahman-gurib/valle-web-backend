import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'package_addons' })
export class PackageAddon {
  @PrimaryGeneratedColumn({ name: 'id' })
  id: number;

  @Column({ name: 'text', type: 'text' })
  text: string;

  @Column({ name: 'price_label', type: 'text' })
  priceLabel: string;

  @Column({ name: 'sort_order', type: 'int' })
  sortOrder: number;
}
