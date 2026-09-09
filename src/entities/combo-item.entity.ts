import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'combo_items' })
export class ComboItem {
  @PrimaryGeneratedColumn({ name: 'id' })
  id: number;

  @Column({ name: 'combo_id', type: 'int' })
  comboId: number;

  @Column({ name: 'text', type: 'text' })
  text: string;

  @Column({ name: 'sort_order', type: 'int' })
  sortOrder: number;
}
