import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'photo_addons' })
export class PhotoAddon {
  @PrimaryGeneratedColumn({ name: 'id' })
  id: number;

  @Column({ name: 'rate', type: 'text' })
  rate: 'rr' | 'nr';

  @Column({ name: 'text', type: 'text' })
  text: string;

  @Column({ name: 'price_label', type: 'text' })
  priceLabel: string;

  @Column({ name: 'sort_order', type: 'int' })
  sortOrder: number;
}
