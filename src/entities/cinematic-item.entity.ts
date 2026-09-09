import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'cinematic_items' })
export class CinematicItem {
  @PrimaryGeneratedColumn({ name: 'id' })
  id: number;

  @Column({ name: 'name', type: 'text' })
  name: string;

  @Column({ name: 'price', type: 'int' })
  price: number;

  @Column({ name: 'sort_order', type: 'int' })
  sortOrder: number;
}
