import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Mirrors the CHECK on `job_applications.status`: the HR pipeline. */
export const APPLICATION_STATUSES = [
  'new',
  'reviewing',
  'shortlisted',
  'interviewed',
  'offered',
  'rejected',
  'hired',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/**
 * One person applying for one vacancy.
 *
 * Every column here is either applicant contact data or an internal HR note, so
 * NOTHING on this entity may ever be returned by a public endpoint. The public
 * `POST /api/vacancies/:slug/apply` answers with `{ id }` and nothing else.
 */
@Entity({ name: 'job_applications' })
export class JobApplication {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id: string;

  @Column({ name: 'vacancy_id', type: 'uuid' })
  vacancyId: string;

  /** Raw applicant input: render as TEXT, never as HTML. */
  @Column({ name: 'full_name', type: 'text' })
  fullName: string;

  @Column({ name: 'email', type: 'text' })
  email: string;

  @Column({ name: 'phone', type: 'text', default: '' })
  phone: string;

  /**
   * A link to a CV rather than an upload. Validated as http(s) only on the way
   * in, because HR renders it as an href.
   */
  @Column({ name: 'cv_url', type: 'text', default: '' })
  cvUrl: string;

  /** Raw applicant input: render as TEXT, never as HTML. */
  @Column({ name: 'cover_letter', type: 'text', default: '' })
  coverLetter: string;

  @Column({ name: 'years_experience', type: 'int', nullable: true })
  yearsExperience: number | null;

  @Column({ name: 'status', type: 'text', default: 'new' })
  status: ApplicationStatus;

  /** Internal only: never leaves an HR-guarded route. */
  @Column({ name: 'hr_note', type: 'text', default: '' })
  hrNote: string;

  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
