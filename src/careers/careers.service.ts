import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JobApplication, JobVacancy } from '../entities';
import { ApplyToVacancyDto, SLUG_PATTERN } from './dto/careers.dto';

/**
 * The listing card. Deliberately a hand-written subset of the entity: adding a
 * column to `job_vacancies` must never widen what the public site can read.
 */
export interface VacancyCard {
  slug: string;
  title: string;
  department: string;
  location: string;
  employment: string;
  summary: string;
  salaryRange: string;
  /** ISO date (YYYY-MM-DD) or null. */
  closesOn: string | null;
  /** ISO date the role was published; feeds JobPosting.datePosted on the public page. */
  postedOn: string;
}

/** The full role page. Still no ids, no author, no applicant data. */
export interface VacancyDetail extends VacancyCard {
  description: string;
  /** One requirement per line. */
  requirements: string;
  benefits: string;
}

/**
 * One message for every "you cannot see this" case. A draft and a typo must be
 * indistinguishable, or the endpoint becomes a way to confirm that an unposted
 * role exists.
 */
const NOT_FOUND = 'No such vacancy';

/** Only published roles exist as far as the public site is concerned. */
const PUBLIC_STATUS = 'published' as const;

/**
 * Public careers surface: the two read endpoints and the application form.
 * Every query in here is pinned to `status = 'published'`, and every response
 * goes through the mappers at the bottom of the file, so applicant data and
 * `hr_note` have no path out.
 */
@Injectable()
export class CareersService {
  constructor(
    @InjectRepository(JobVacancy)
    private readonly vacancyRepo: Repository<JobVacancy>,
    @InjectRepository(JobApplication)
    private readonly applicationRepo: Repository<JobApplication>,
  ) {}

  /** Open roles, newest first. */
  async listPublished(): Promise<VacancyCard[]> {
    const rows = await this.vacancyRepo
      .createQueryBuilder('v')
      .where('v.status = :status', { status: PUBLIC_STATUS })
      .orderBy('v.createdAt', 'DESC')
      .getMany();

    return rows.map(toVacancyCard);
  }

  /** One open role. 404 when it is missing, a draft, or closed. */
  async findPublished(slug: string): Promise<VacancyDetail> {
    return toVacancyDetail(await this.publishedBySlug(slug));
  }

  /**
   * Record an application against an open role.
   *
   * Returns the new id and nothing else: the caller is an anonymous visitor, so
   * the response must not carry anything they did not already send.
   */
  async apply(
    slug: string,
    dto: ApplyToVacancyDto,
  ): Promise<{ id: string }> {
    const vacancy = await this.publishedBySlug(slug);

    const saved = await this.applicationRepo.save(
      this.applicationRepo.create({
        vacancyId: vacancy.id,
        fullName: dto.fullName,
        email: dto.email,
        phone: dto.phone ?? '',
        cvUrl: dto.cvUrl ?? '',
        coverLetter: dto.coverLetter ?? '',
        yearsExperience: dto.yearsExperience ?? null,
        status: 'new',
        hrNote: '',
        reviewedBy: null,
      }),
    );

    return { id: saved.id };
  }

  /**
   * The single gate every public route goes through. The status is part of the
   * WHERE rather than a check afterwards, so a draft cannot be read even by a
   * future caller that forgets to test the result.
   */
  private async publishedBySlug(slug: string): Promise<JobVacancy> {
    // A slug that could not have been generated cannot match a row; skip the
    // round trip and answer exactly as we would for an unknown one.
    if (!SLUG_PATTERN.test(slug)) throw new NotFoundException(NOT_FOUND);

    const vacancy = await this.vacancyRepo.findOne({
      where: { slug, status: PUBLIC_STATUS },
    });
    if (!vacancy) throw new NotFoundException(NOT_FOUND);
    return vacancy;
  }
}

// --------------------------------------------------------------------- mappers

/** `date` columns arrive as strings; tolerate a Date in case a driver parses them. */
function toDateString(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date
    ? value.toLocaleDateString('en-CA')
    : String(value).slice(0, 10);
}

function toVacancyCard(v: JobVacancy): VacancyCard {
  return {
    slug: v.slug,
    title: v.title,
    department: v.department,
    location: v.location,
    employment: v.employment,
    summary: v.summary,
    salaryRange: v.salaryRange,
    closesOn: toDateString(v.closesOn),
    postedOn: toDateString(v.createdAt) ?? '',
  };
}

function toVacancyDetail(v: JobVacancy): VacancyDetail {
  return {
    ...toVacancyCard(v),
    description: v.description,
    requirements: v.requirements,
    benefits: v.benefits,
  };
}
