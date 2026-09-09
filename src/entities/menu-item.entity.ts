import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'menu_items' })
export class MenuItem {
  @PrimaryGeneratedColumn({ name: 'id' })
  id: number;

  @Column({ name: 'group_id', type: 'int' })
  groupId: number;

  @Column({ name: 'name', type: 'text' })
  name: string;

  @Column({ name: 'note', type: 'text', default: '' })
  note: string;

  @Column({ name: 'price_label', type: 'text' })
  priceLabel: string;

  @Column({ name: 'sort_order', type: 'int' })
  sortOrder: number;
}
