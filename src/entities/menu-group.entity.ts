import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'menu_groups' })
export class MenuGroup {
  @PrimaryGeneratedColumn({ name: 'id' })
  id: number;

  @Column({ name: 'restaurant_id', type: 'text' })
  restaurantId: string;

  @Column({ name: 'title', type: 'text' })
  title: string;

  @Column({ name: 'sort_order', type: 'int' })
  sortOrder: number;
}
