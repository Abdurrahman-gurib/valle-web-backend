import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** VIP Ultimate inclusions. */
@Entity({ name: 'vip_items' })
export class VipItem {
  @PrimaryGeneratedColumn({ name: 'id' })
  id: number;

  @Column({ name: 'text', type: 'text' })
  text: string;

  @Column({ name: 'sort_order', type: 'int' })
  sortOrder: number;
}
