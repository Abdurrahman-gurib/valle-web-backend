import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Mirrors the CHECK on `job_vacancies.employment`. */
export const EMPLOYMENT_TYPES = [
  'full-time',
  'part-time',
  'seasonal',
  'internship',
] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

/**
 * Mirrors the CHECK on `job_vacancies.status`.
 * Only `published` is ever visible to the public site.
 */
export const VACANCY_STATUSES = ['draft', 'published', 'closed'] as const;
export type VacancyStatus = (typeof VACANCY_STATUSES)[number];

/**
 * One open (or drafted, or closed) role. HR owns the whole row; the public
 * careers pages only ever see a hand-picked subset of these columns, and only
 * while `status = 'published'`.
 */
@Entity({ name: 'job_vacancies' })
export class JobVacancy {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id: string;

  /** URL-safe, derived server-side from the title, unique. */
  @Column({ name: 'slug', type: 'text', unique: true })
  slug: string;

  @Column({ name: 'title', type: 'text' })
  title: string;

  @Column({ name: 'department', type: 'text', default: '' })
  department: string;

  @Column({ name: 'location', type: 'text', default: 'Chamouny, Mauritius' })
  location: string;

  @Column({ name: 'employment', type: 'text', default: 'full-time' })
  employment: EmploymentType;

  /** One line for the listing card. */
  @Column({ name: 'summary', type: 'text', default: '' })
  summary: string;

  @Column({ name: 'description', type: 'text', default: '' })
  description: string;

  /** One requirement per line: the frontend splits on newlines. */
  @Column({ name: 'requirements', type: 'text', default: '' })
  requirements: string;

  @Column({ name: 'benefits', type: 'text', default: '' })
  benefits: string;

  @Column({ name: 'salary_range', type: 'text', default: '' })
  salaryRange: string;

  @Column({ name: 'status', type: 'text', default: 'draft' })
  status: VacancyStatus;

  /** ISO date (YYYY-MM-DD), or null when the role has no closing date. */
  @Column({ name: 'closes_on', type: 'date', nullable: true })
  closesOn: string | null;

  /** The HR operator who posted it. Internal: never returned publicly. */
  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
