import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { AVAILABILITY_MAX_DAYS } from '../bookings.service';

export class AvailabilityQueryDto {
  @ApiPropertyOptional({ description: 'First date, YYYY-MM-DD. Default: today at the park.' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @ApiPropertyOptional({ description: `Number of days, 1..${AVAILABILITY_MAX_DAYS}. Default 14.` })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(AVAILABILITY_MAX_DAYS)
  days?: number;
}
