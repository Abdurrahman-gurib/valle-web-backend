import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Price list rows for detail pages + admission. */
@Entity({ name: 'price_list' })
export class PriceListEntry {
  @PrimaryGeneratedColumn({ name: 'id' })
  id: number;

  /** 'admission' or an experience id */
  @Column({ name: 'group_key', type: 'text' })
  groupKey: string;

  @Column({ name: 'label', type: 'text' })
  label: string;

  /** resident MUR (0 = FREE) */
  @Column({ name: 'rr', type: 'int' })
  rr: number;

  /** non-resident MUR */
  @Column({ name: 'nr', type: 'int' })
  nr: number;

  @Column({ name: 'sort_order', type: 'int' })
  sortOrder: number;
}
