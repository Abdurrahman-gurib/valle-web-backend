import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Editorial gallery blocks on experience detail pages. */
@Entity({ name: 'experience_galleries' })
export class ExperienceGallery {
  @PrimaryColumn({ name: 'experience_id', type: 'text' })
  experienceId: string;

  @Column({ name: 'eyebrow', type: 'text' })
  eyebrow: string;

  @Column({ name: 't1', type: 'text' })
  t1: string;

  @Column({ name: 't2', type: 'text' })
  t2: string;

  @Column({ name: 'copy', type: 'text' })
  copy: string;

  @Column({ name: 'foot', type: 'text' })
  foot: string;

  @Column({ name: 'cta', type: 'text' })
  cta: string;
}
