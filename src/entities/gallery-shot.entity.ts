import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'gallery_shots' })
export class GalleryShot {
  @PrimaryGeneratedColumn({ name: 'id' })
  id: number;

  @Column({ name: 'experience_id', type: 'text' })
  experienceId: string;

  @Column({ name: 'src', type: 'text' })
  src: string;

  @Column({ name: 'tag', type: 'text' })
  tag: string;

  @Column({ name: 'cap', type: 'text' })
  cap: string;

  /** optional object-position override */
  @Column({ name: 'pos', type: 'text', nullable: true })
  pos: string | null;

  @Column({ name: 'sort_order', type: 'int' })
  sortOrder: number;
}
