import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'hero_slides' })
export class HeroSlide {
  @PrimaryGeneratedColumn({ name: 'id' })
  id: number;

  @Column({ name: 'src', type: 'text' })
  src: string;

  @Column({ name: 'sort_order', type: 'int' })
  sortOrder: number;
}
