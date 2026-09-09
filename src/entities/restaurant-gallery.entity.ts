import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'restaurant_gallery' })
export class RestaurantGalleryImage {
  @PrimaryGeneratedColumn({ name: 'id' })
  id: number;

  @Column({ name: 'restaurant_id', type: 'text' })
  restaurantId: string;

  @Column({ name: 'src', type: 'text' })
  src: string;

  @Column({ name: 'sort_order', type: 'int' })
  sortOrder: number;
}
