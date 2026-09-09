import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, TransformFnParams, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  IsCalendarDate,
  IsSafeText,
  MAX_PAGE,
} from '../../common/validation';
import {
  APPLICATION_STATUSES,
  ApplicationStatus,
} from '../../entities/job-application.entity';
import {
  EMPLOYMENT_TYPES,
  EmploymentType,
  VACANCY_STATUSES,
  VacancyStatus,
} from '../../entities/job-vacancy.entity';

/**
 * A brand new role is either kept back or put live. `closed` is reached by
 * editing an existing one, which is what HR is told to do instead of deleting.
 */
export const CREATABLE_VACANCY_STATUSES = ['draft', 'published'] as const;
export type CreatableVacancyStatus = (typeof CREATABLE_VACANCY_STATUSES)[number];

/** Same clamps as the reservations dashboard, so both lists page alike. */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export const TITLE_MAX_LENGTH = 120;
export const SUMMARY_MAX_LENGTH = 280;
export const LONG_TEXT_MAX_LENGTH = 8000;
export const HR_NOTE_MAX_LENGTH = 4000;

const trimmed = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** The HR forms post `''` for "leave this empty"; a date must not become `''`. */
const optionalDate = ({ value }: TransformFnParams): unknown => {
  if (value === '' || value === null) return null;
  return typeof value === 'string' ? value.trim() : value;
};

// ------------------------------------------------------------------- queries

/** Shared page/pageSize query params. */
export class HrPageQueryDto {
  // Max as well as Min: without an upper bound, page=1e20 survives IsInt and
  // overflows the SQL OFFSET, which comes back as a 500.
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: DEFAULT_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number;
}

export class ListVacanciesQueryDto {
  @ApiPropertyOptional({ enum: VACANCY_STATUSES })
  @IsOptional()
  @IsIn(VACANCY_STATUSES)
  status?: VacancyStatus;
}

export class ListApplicationsQueryDto extends HrPageQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  vacancyId?: string;

  @ApiPropertyOptional({ enum: APPLICATION_STATUSES })
  @IsOptional()
  @IsIn(APPLICATION_STATUSES)
  status?: ApplicationStatus;

  @ApiPropertyOptional({
    description: 'Case-insensitive match on the applicant name or email',
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsSafeText()
  @MaxLength(120)
  q?: string;
}

// ------------------------------------------------------------------ vacancies

export class CreateVacancyDto {
  @ApiProperty({ example: 'Zipline guide', minLength: 3, maxLength: TITLE_MAX_LENGTH })
  @Transform(trimmed)
  @IsString()
  @IsSafeText()
  @MinLength(3)
  @MaxLength(TITLE_MAX_LENGTH)
  title: string;

  @ApiPropertyOptional({ example: 'Adventure', maxLength: 80 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsSafeText()
  @MaxLength(80)
  department?: string;

  @ApiPropertyOptional({ example: 'Chamouny, Mauritius', maxLength: 120 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsSafeText()
  @MaxLength(120)
  location?: string;

  @ApiProperty({ enum: EMPLOYMENT_TYPES })
  @IsIn(EMPLOYMENT_TYPES)
  employment: EmploymentType;

  @ApiPropertyOptional({ maxLength: SUMMARY_MAX_LENGTH })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsSafeText()
  @MaxLength(SUMMARY_MAX_LENGTH)
  summary?: string;

  @ApiPropertyOptional({ maxLength: LONG_TEXT_MAX_LENGTH })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsSafeText()
  @MaxLength(LONG_TEXT_MAX_LENGTH)
  description?: string;

  @ApiPropertyOptional({
    maxLength: LONG_TEXT_MAX_LENGTH,
    description: 'One requirement per line',
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsSafeText()
  @MaxLength(LONG_TEXT_MAX_LENGTH)
  requirements?: string;

  @ApiPropertyOptional({ maxLength: LONG_TEXT_MAX_LENGTH })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsSafeText()
  @MaxLength(LONG_TEXT_MAX_LENGTH)
  benefits?: string;

  @ApiPropertyOptional({ example: 'Rs 22,000 - Rs 28,000', maxLength: 120 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsSafeText()
  @MaxLength(120)
  salaryRange?: string;

  @ApiProperty({ enum: CREATABLE_VACANCY_STATUSES })
  @IsIn(CREATABLE_VACANCY_STATUSES)
  status: CreatableVacancyStatus;

  @ApiPropertyOptional({ example: '2026-09-30', nullable: true })
  @IsOptional()
  // Shape alone let 2026-02-30 through to the date column, where Postgres
  // rejected it as a 500; IsCalendarDate also checks the day exists.
  @Transform(optionalDate)
  @IsCalendarDate()
  closesOn?: string | null;
}

/**
 * Partial update. Same rules as create, with two differences that are
 * deliberate: every field is optional, and `closed` becomes reachable so HR can
 * retire a role that already has applications instead of deleting it.
 */
export class UpdateVacancyDto {
  @ApiPropertyOptional({ minLength: 3, maxLength: TITLE_MAX_LENGTH })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsSafeText()
  @MinLength(3)
  @MaxLength(TITLE_MAX_LENGTH)
  title?: string;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsSafeText()
  @MaxLength(80)
  department?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsSafeText()
  @MaxLength(120)
  location?: string;

  @ApiPropertyOptional({ enum: EMPLOYMENT_TYPES })
  @IsOptional()
  @IsIn(EMPLOYMENT_TYPES)
  employment?: EmploymentType;

  @ApiPropertyOptional({ maxLength: SUMMARY_MAX_LENGTH })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsSafeText()
  @MaxLength(SUMMARY_MAX_LENGTH)
  summary?: string;

  @ApiPropertyOptional({ maxLength: LONG_TEXT_MAX_LENGTH })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsSafeText()
  @MaxLength(LONG_TEXT_MAX_LENGTH)
  description?: string;

  @ApiPropertyOptional({ maxLength: LONG_TEXT_MAX_LENGTH })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsSafeText()
  @MaxLength(LONG_TEXT_MAX_LENGTH)
  requirements?: string;

  @ApiPropertyOptional({ maxLength: LONG_TEXT_MAX_LENGTH })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsSafeText()
  @MaxLength(LONG_TEXT_MAX_LENGTH)
  benefits?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsSafeText()
  @MaxLength(120)
  salaryRange?: string;

  @ApiPropertyOptional({ enum: VACANCY_STATUSES })
  @IsOptional()
  @IsIn(VACANCY_STATUSES)
  status?: VacancyStatus;

  @ApiPropertyOptional({ example: '2026-09-30', nullable: true })
  @IsOptional()
  // Shape alone let 2026-02-30 through to the date column, where Postgres
  // rejected it as a 500; IsCalendarDate also checks the day exists.
  @Transform(optionalDate)
  @IsCalendarDate()
  closesOn?: string | null;
}

// ---------------------------------------------------------------- applications

export class UpdateApplicationDto {
  @ApiPropertyOptional({ enum: APPLICATION_STATUSES })
  @IsOptional()
  @IsIn(APPLICATION_STATUSES)
  status?: ApplicationStatus;

  @ApiPropertyOptional({ maxLength: HR_NOTE_MAX_LENGTH })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsSafeText()
  @MaxLength(HR_NOTE_MAX_LENGTH)
  hrNote?: string;
}
