import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** "Good to know" bullets. */
@Entity({ name: 'experience_facts' })
export class ExperienceFact {
  @PrimaryGeneratedColumn({ name: 'id' })
  id: number;

  @Column({ name: 'experience_id', type: 'text' })
  experienceId: string;

  @Column({ name: 'text', type: 'text' })
  text: string;

  @Column({ name: 'sort_order', type: 'int' })
  sortOrder: number;
}
