import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'restaurants' })
export class Restaurant {
  /** chamouze | citronelle */
  @PrimaryColumn({ name: 'id', type: 'text' })
  id: string;

  @Column({ name: 'name', type: 'text' })
  name: string;

  @Column({ name: 'badge', type: 'text' })
  badge: string;

  @Column({ name: 'image', type: 'text' })
  image: string;

  @Column({ name: 'tag', type: 'text' })
  tag: string;

  @Column({ name: 'cuisine', type: 'text' })
  cuisine: string;

  @Column({ name: 'hours_label', type: 'text' })
  hoursLabel: string;

  @Column({ name: 'price_label', type: 'text' })
  priceLabel: string;

  @Column({ name: 'setting_label', type: 'text' })
  settingLabel: string;

  @Column({ name: 'about', type: 'text' })
  about: string;

  @Column({ name: 'detail', type: 'text' })
  detail: string;

  @Column({ name: 'menu_pdf', type: 'text', default: '' })
  menuPdf: string;

  @Column({ name: 'sort_order', type: 'int' })
  sortOrder: number;
}
