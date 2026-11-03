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

  /** A line under the group, e.g. what is included with every dish; '' = none. */
  @Column({ name: 'note', type: 'text', default: '' })
  note: string;

  /** Allergen codes of what the note describes, comma separated. */
  @Column({ name: 'note_allergens', type: 'text', default: '' })
  noteAllergens: string;
}
