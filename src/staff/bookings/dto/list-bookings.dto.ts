import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  IsCalendarDate,
  IsSafeText,
  MAX_PAGE,
} from '../../../common/validation';

export const BOOKING_STATUSES = ['confirmed', 'arrived', 'cancelled'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const DEFAULT_PAGE_SIZE = 25;
export const SORTS = ['newest', 'oldest', 'visit_asc', 'visit_desc', 'total_desc', 'total_asc', 'guest'] as const;
export type BookingSort = (typeof SORTS)[number];

export const MAX_PAGE_SIZE = 100;

/** Shared page/pageSize query params. */
export class PageQueryDto {
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

export class ListBookingsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: BOOKING_STATUSES })
  @IsOptional()
  @IsIn(BOOKING_STATUSES)
  status?: BookingStatus;

  // The regex only ever checked the shape, so 2026-02-30 reached the date
  // comparison and Postgres answered with a 500. IsCalendarDate checks the day.
  @ApiPropertyOptional({ example: '2026-08-01', description: 'visitDate >= from' })
  @IsOptional()
  @IsCalendarDate()
  from?: string;

  @ApiPropertyOptional({ example: '2026-08-31', description: 'visitDate <= to' })
  @IsOptional()
  @IsCalendarDate()
  to?: string;

  @ApiPropertyOptional({ enum: ['morning', 'afternoon'] })
  @IsOptional()
  @IsIn(['morning', 'afternoon'])
  slot?: 'morning' | 'afternoon';

  @ApiPropertyOptional({ enum: ['gate', 'online'] })
  @IsOptional()
  @IsIn(['gate', 'online'])
  payMode?: 'gate' | 'online';

  @ApiPropertyOptional({ enum: ['rr', 'nr'] })
  @IsOptional()
  @IsIn(['rr', 'nr'])
  rate?: 'rr' | 'nr';

  @ApiPropertyOptional({ description: 'Exact nationality as stored (see the nationality list)', maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  nationality?: string;

  @ApiPropertyOptional({ enum: SORTS, default: 'newest' })
  @IsOptional()
  @IsIn(SORTS)
  sort?: BookingSort;

  @ApiPropertyOptional({
    description: 'Case-insensitive match on refCode / guestName / email / phone',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsSafeText()
  @MaxLength(120)
  q?: string;
}
