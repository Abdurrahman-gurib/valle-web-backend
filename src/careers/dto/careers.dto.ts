import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, TransformFnParams } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { IsSafeText } from '../../common/validation';

/** Shape of every slug the server generates, so anything else is a 404. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const CV_URL_MAX_LENGTH = 500;
export const COVER_LETTER_MAX_LENGTH = 4000;

const trimmed = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * The public form posts empty strings for fields the applicant left blank.
 * Treat those as "not supplied" so an empty box is not a validation error,
 * while a non-empty value still has to satisfy every rule below.
 */
const optionalText = ({ value }: TransformFnParams): unknown => {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  return text.length > 0 ? text : undefined;
};

/** `''` / null from an untouched number input must not become 0. */
const optionalInt = ({ value }: TransformFnParams): unknown => {
  if (value === '' || value === null || value === undefined) return undefined;
  return typeof value === 'string' ? Number(value) : value;
};

export class VacancySlugParamDto {
  @ApiProperty({ example: 'zipline-guide', pattern: SLUG_PATTERN.source })
  @IsString()
  @IsSafeText()
  @MaxLength(120)
  slug: string;
}

/** Public application payload. Nothing here is ever echoed back to a visitor. */
export class ApplyToVacancyDto {
  @ApiProperty({ example: 'Ariane Léger', minLength: 2, maxLength: 120 })
  @Transform(trimmed)
  @IsString()
  @IsSafeText()
  @MinLength(2)
  @MaxLength(120)
  fullName: string;

  @ApiProperty({ example: 'ariane@example.com', maxLength: 160 })
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @IsSafeText()
  @IsEmail()
  @MaxLength(160)
  email: string;

  @ApiPropertyOptional({ example: '+230 5555 1234', maxLength: 40 })
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @IsSafeText()
  @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional({
    example: 'https://drive.example.com/cv.pdf',
    maxLength: CV_URL_MAX_LENGTH,
    description: 'http(s) link to a CV. Other schemes are rejected.',
  })
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @IsSafeText()
  @MaxLength(CV_URL_MAX_LENGTH)
  // HR renders this as an href, so the scheme is pinned here, at the only point
  // where the value can enter the database: `javascript:` and `data:` links
  // never become stored XSS if they can never be stored.
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { message: 'cvUrl must be an http(s) link' },
  )
  cvUrl?: string;

  @ApiPropertyOptional({ maxLength: COVER_LETTER_MAX_LENGTH })
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @IsSafeText()
  @MaxLength(COVER_LETTER_MAX_LENGTH)
  coverLetter?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 60, example: 3 })
  @IsOptional()
  @Transform(optionalInt)
  @IsInt()
  @Min(0)
  @Max(60)
  yearsExperience?: number;
}
