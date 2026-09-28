import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Inclusive visit-date range. Defaults (this month) are applied in the controller. */
export class RangeQueryDto {
  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @Matches(DATE)
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @Matches(DATE)
  to?: string;
}

export class DateQueryDto {
  @ApiPropertyOptional({ example: '2026-10-02', description: 'Default: today at the park' })
  @IsOptional()
  @Matches(DATE)
  date?: string;
}

export class ForecastQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 90, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number;
}

export const EXPORT_TYPES = ['bookings', 'daily', 'nationalities', 'experiences'] as const;
export type ExportType = (typeof EXPORT_TYPES)[number];

export class ExportQueryDto extends RangeQueryDto {
  @ApiPropertyOptional({ enum: EXPORT_TYPES, default: 'bookings' })
  @IsOptional()
  @IsIn(EXPORT_TYPES)
  type?: ExportType;
}
