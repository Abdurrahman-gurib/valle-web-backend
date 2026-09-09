import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { JobApplication, JobVacancy } from '../entities';
import type { ApplicationStatus } from '../entities/job-application.entity';
import type {
  EmploymentType,
  VacancyStatus,
} from '../entities/job-vacancy.entity';
import type { StaffPrincipal } from '../staff/auth/staff-auth.types';
import {
  CreateVacancyDto,
  DEFAULT_PAGE_SIZE,
  HrPageQueryDto,
  ListApplicationsQueryDto,
  ListVacanciesQueryDto,
  MAX_PAGE_SIZE,
  UpdateApplicationDto,
  UpdateVacancyDto,
} from './dto/hr.dto';

/** The park's wall clock, matching StaffBookingsService. */
const PARK_TZ = 'Indian/Mauritius';

/** "This week" is the last seven park days, today included. */
const WEEK_DAYS = 7;

/** Longest slug we will generate, leaving room for a `-nn` suffix. */
const SLUG_MAX_LENGTH = 80;

/** Give up on `-2`, `-3`, ... well before it could become a hot loop. */
const MAX_SLUG_ATTEMPTS = 200;

/** How many times a losing race for a slug is retried before it surfaces. */
const MAX_INSERT_ATTEMPTS = 5;

const PG_UNIQUE_VIOLATION = '23505';

export interface HrVacancyRow {
  id: string;
  slug: string;
  title: string;
  department: string;
  location: string;
  employment: EmploymentType;
  summary: string;
  description: string;
  requirements: string;
  benefits: string;
  salaryRange: string;
  status: VacancyStatus;
  /** ISO date (YYYY-MM-DD) or null. */
  closesOn: string | null;
  applicationCount: number;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601 */
  updatedAt: string;
}

export interface HrApplicationRow {
  id: string;
  vacancyId: string;
  vacancyTitle: string;
  vacancySlug: string;
  fullName: string;
  email: string;
  phone: string;
  cvUrl: string;
  coverLetter: string;
  yearsExperience: number | null;
  status: ApplicationStatus;
  /** Internal note: HR-guarded routes only. */
  hrNote: string;
  reviewedBy: string | null;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601 */
  updatedAt: string;
}

export interface HrPaged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface HrStats {
  /** Roles currently live on the public site. */
  openVacancies: number;
  draftVacancies: number;
  /** Applications nobody has triaged yet. */
  newApplications: number;
  /** Applications received in the last seven park days. */
  applicationsThisWeek: number;
}

/**
 * Careers back office. Everything here is reachable only behind
 * `StaffAuthGuard` + `RolesGuard('hr','manager')`, which is what lets these
 * rows carry `hr_note` and applicant contact details.
 */
@Injectable()
export class HrService {
  constructor(
    @InjectRepository(JobVacancy)
    private readonly vacancyRepo: Repository<JobVacancy>,
    @InjectRepository(JobApplication)
    private readonly applicationRepo: Repository<JobApplication>,
  ) {}

  // ---------------------------------------------------------------- vacancies

  /** Every vacancy including drafts, newest first, each with its tally. */
  async listVacancies(
    query: ListVacanciesQueryDto,
  ): Promise<{ items: HrVacancyRow[] }> {
    const qb = this.vacancyRepo.createQueryBuilder('v');
    if (query.status) {
      qb.andWhere('v.status = :status', { status: query.status });
    }
    const rows = await qb.orderBy('v.createdAt', 'DESC').getMany();

    const counts = await this.countApplications(rows.map((r) => r.id));
    return {
      items: rows.map((v) => toVacancyRow(v, counts.get(v.id) ?? 0)),
    };
  }

  async createVacancy(
    dto: CreateVacancyDto,
    staff: StaffPrincipal,
  ): Promise<HrVacancyRow> {
    const base = slugify(dto.title);

    // Two operators posting the same title at the same moment would both read
    // the same free slug, so the unique index is the real arbiter: on a
    // collision, look again rather than handing back a 500.
    for (let attempt = 1; attempt <= MAX_INSERT_ATTEMPTS; attempt += 1) {
      const slug = await this.freeSlug(base);
      try {
        const saved = await this.vacancyRepo.save(
          this.vacancyRepo.create({
            slug,
            title: dto.title,
            department: dto.department ?? '',
            location: dto.location ?? 'Chamouny, Mauritius',
            employment: dto.employment,
            summary: dto.summary ?? '',
            description: dto.description ?? '',
            requirements: dto.requirements ?? '',
            benefits: dto.benefits ?? '',
            salaryRange: dto.salaryRange ?? '',
            status: dto.status,
            closesOn: dto.closesOn ?? null,
            createdBy: staff.id,
          }),
        );
        return toVacancyRow(saved, 0);
      } catch (error) {
        if (!isUniqueViolation(error) || attempt === MAX_INSERT_ATTEMPTS) {
          throw error;
        }
      }
    }

    throw new ConflictException(
      'Could not allocate a unique web address for this role, please try again',
    );
  }

  /**
   * Partial update. The slug is intentionally NOT re-derived on a rename: it is
   * the public URL, and quietly moving a posted role would break every link
   * already shared with candidates.
   */
  async updateVacancy(
    id: string,
    dto: UpdateVacancyDto,
  ): Promise<HrVacancyRow> {
    const vacancy = await this.vacancyRepo.findOne({ where: { id } });
    if (!vacancy) throw new NotFoundException('No such vacancy');

    if (dto.title !== undefined) vacancy.title = dto.title;
    if (dto.department !== undefined) vacancy.department = dto.department;
    if (dto.location !== undefined) vacancy.location = dto.location;
    if (dto.employment !== undefined) vacancy.employment = dto.employment;
    if (dto.summary !== undefined) vacancy.summary = dto.summary;
    if (dto.description !== undefined) vacancy.description = dto.description;
    if (dto.requirements !== undefined) vacancy.requirements = dto.requirements;
    if (dto.benefits !== undefined) vacancy.benefits = dto.benefits;
    if (dto.salaryRange !== undefined) vacancy.salaryRange = dto.salaryRange;
    if (dto.status !== undefined) vacancy.status = dto.status;
    // `null` is a real value here: it clears the closing date.
    if (dto.closesOn !== undefined) vacancy.closesOn = dto.closesOn;

    const saved = await this.vacancyRepo.save(vacancy);
    const counts = await this.countApplications([saved.id]);
    return toVacancyRow(saved, counts.get(saved.id) ?? 0);
  }

  /**
   * Delete, but only while nobody has applied. Applications cascade in the
   * database, so allowing this would silently destroy candidate history: HR is
   * told to close the role instead.
   */
  async deleteVacancy(id: string): Promise<{ ok: true }> {
    const vacancy = await this.vacancyRepo.findOne({ where: { id } });
    if (!vacancy) throw new NotFoundException('No such vacancy');

    const applications = await this.applicationRepo.count({
      where: { vacancyId: id },
    });
    if (applications > 0) {
      throw new ConflictException(
        `This role has ${applications} application(s) on file. Set its status to "closed" instead of deleting it, so the applicant history is kept.`,
      );
    }

    await this.vacancyRepo.delete({ id });
    return { ok: true };
  }

  // ------------------------------------------------------------- applications

  async listApplications(
    query: ListApplicationsQueryDto,
  ): Promise<HrPaged<HrApplicationRow>> {
    const { page, pageSize } = resolvePaging(query);
    const qb = this.applicationRepo.createQueryBuilder('a');

    if (query.vacancyId) {
      qb.andWhere('a.vacancyId = :vacancyId', { vacancyId: query.vacancyId });
    }
    if (query.status) {
      qb.andWhere('a.status = :status', { status: query.status });
    }
    const term = query.q?.trim();
    if (term) {
      // One bound parameter across both columns; the wildcards are added here,
      // never by concatenating the term into the SQL text.
      qb.andWhere('(a.fullName ILIKE :q OR a.email ILIKE :q)', {
        q: `%${term}%`,
      });
    }

    const [rows, total] = await qb
      .orderBy('a.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    const vacancies = await this.vacanciesByIds(rows.map((r) => r.vacancyId));
    return {
      items: rows.map((a) => toApplicationRow(a, vacancies.get(a.vacancyId))),
      total,
      page,
      pageSize,
    };
  }

  async updateApplication(
    id: string,
    dto: UpdateApplicationDto,
    staff: StaffPrincipal,
  ): Promise<HrApplicationRow> {
    if (dto.status === undefined && dto.hrNote === undefined) {
      throw new BadRequestException('Send a status or an hrNote to update');
    }

    const application = await this.applicationRepo.findOne({ where: { id } });
    if (!application) throw new NotFoundException('No such application');

    if (dto.status !== undefined) application.status = dto.status;
    if (dto.hrNote !== undefined) application.hrNote = dto.hrNote;
    // Whoever last touched the file owns it: taken from the session, never
    // from the request body.
    application.reviewedBy = staff.id;

    const saved = await this.applicationRepo.save(application);
    const vacancies = await this.vacanciesByIds([saved.vacancyId]);
    return toApplicationRow(saved, vacancies.get(saved.vacancyId));
  }

  // -------------------------------------------------------------------- stats

  async stats(): Promise<HrStats> {
    const weekStart = daysAgo(parkToday(), WEEK_DAYS - 1);

    const [openVacancies, draftVacancies, newApplications, applicationsThisWeek] =
      await Promise.all([
        this.vacancyRepo.count({ where: { status: 'published' } }),
        this.vacancyRepo.count({ where: { status: 'draft' } }),
        this.applicationRepo.count({ where: { status: 'new' } }),
        // created_at is a timestamptz, so shift it into the park's zone before
        // taking the calendar date, or a late-evening application lands on the
        // wrong day.
        this.applicationRepo
          .createQueryBuilder('a')
          .where('(a.createdAt AT TIME ZONE CAST(:tz AS text))::date >= :from', {
            tz: PARK_TZ,
            from: weekStart,
          })
          .getCount(),
      ]);

    return {
      openVacancies,
      draftVacancies,
      newApplications,
      applicationsThisWeek,
    };
  }

  // ------------------------------------------------------------------ helpers

  /**
   * Application tallies for a batch of vacancies in ONE grouped query. The
   * whole point of this method is that the list endpoint never issues a count
   * per row.
   */
  private async countApplications(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map<string, number>();

    const raw = await this.applicationRepo
      .createQueryBuilder('a')
      .select('a.vacancyId', 'vacancyId')
      .addSelect('COUNT(*)', 'count')
      .where('a.vacancyId IN (:...ids)', { ids })
      .groupBy('a.vacancyId')
      .getRawMany<{ vacancyId: string; count: string | number }>();

    return new Map(raw.map((r) => [r.vacancyId, Number(r.count)]));
  }

  /** Titles for a page of applications, in one query rather than one per row. */
  private async vacanciesByIds(
    ids: string[],
  ): Promise<Map<string, JobVacancy>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map<string, JobVacancy>();

    const rows = await this.vacancyRepo.find({ where: { id: In(unique) } });
    return new Map(rows.map((v) => [v.id, v]));
  }

  /**
   * `base`, or the first free `base-2`, `base-3`, ... Only slugs sharing the
   * base are read, and `base` is already reduced to `[a-z0-9-]`, so the LIKE
   * pattern carries no user-controlled wildcards.
   */
  private async freeSlug(base: string): Promise<string> {
    const rows = await this.vacancyRepo
      .createQueryBuilder('v')
      .select('v.slug', 'slug')
      .where('v.slug = :base OR v.slug LIKE :prefix', {
        base,
        prefix: `${base}-%`,
      })
      .getRawMany<{ slug: string }>();

    const taken = new Set(rows.map((r) => r.slug));
    if (!taken.has(base)) return base;

    for (let n = 2; n <= MAX_SLUG_ATTEMPTS; n += 1) {
      const candidate = `${base}-${n}`;
      if (!taken.has(candidate)) return candidate;
    }
    // Practically unreachable; still deterministic rather than a thrown error.
    return `${base}-${Date.now()}`;
  }
}

// --------------------------------------------------------------------- helpers

/**
 * Title to URL slug: strip accents, lowercase, and keep only `a-z0-9`,
 * collapsing everything else into single dashes. The result feeds a parameter,
 * never raw SQL, but pinning the character set also keeps the public URL clean.
 */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
  // A title of pure punctuation or non-Latin script still needs an address.
  return slug || 'vacancy';
}

/** Same clamping as StaffBookingsService: the DTO validates, this enforces. */
function resolvePaging(query: HrPageQueryDto): {
  page: number;
  pageSize: number;
} {
  const page = Math.max(1, Math.trunc(Number(query.page) || 1));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.trunc(Number(query.pageSize) || DEFAULT_PAGE_SIZE)),
  );
  return { page, pageSize };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}

/** Today at the park, as YYYY-MM-DD. */
function parkToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: PARK_TZ });
}

function daysAgo(day: string, days: number): string {
  const from = new Date(`${day}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - days);
  return from.toISOString().slice(0, 10);
}

/** `date` columns arrive as strings; tolerate a Date in case a driver parses them. */
function toDateString(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date
    ? value.toLocaleDateString('en-CA')
    : String(value).slice(0, 10);
}

function toIso(value: string | Date): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toVacancyRow(v: JobVacancy, applicationCount: number): HrVacancyRow {
  return {
    id: v.id,
    slug: v.slug,
    title: v.title,
    department: v.department,
    location: v.location,
    employment: v.employment,
    summary: v.summary,
    description: v.description,
    requirements: v.requirements,
    benefits: v.benefits,
    salaryRange: v.salaryRange,
    status: v.status,
    closesOn: toDateString(v.closesOn),
    applicationCount,
    createdAt: toIso(v.createdAt),
    updatedAt: toIso(v.updatedAt),
  };
}

function toApplicationRow(
  a: JobApplication,
  vacancy?: JobVacancy,
): HrApplicationRow {
  return {
    id: a.id,
    vacancyId: a.vacancyId,
    vacancyTitle: vacancy?.title ?? '',
    vacancySlug: vacancy?.slug ?? '',
    fullName: a.fullName,
    email: a.email,
    phone: a.phone,
    cvUrl: a.cvUrl,
    coverLetter: a.coverLetter,
    yearsExperience: a.yearsExperience,
    status: a.status,
    hrNote: a.hrNote,
    reviewedBy: a.reviewedBy,
    createdAt: toIso(a.createdAt),
    updatedAt: toIso(a.updatedAt),
  };
}
