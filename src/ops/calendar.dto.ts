import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { IsSafeText } from '../common/validation';

export class ClosureDto {
  @ApiProperty({ example: '2026-12-25' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from: string;

  @ApiProperty({ example: '2026-12-26' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to: string;

  @ApiProperty({ enum: ['all', 'morning', 'afternoon'] })
  @IsIn(['all', 'morning', 'afternoon'])
  slot: 'all' | 'morning' | 'afternoon';

  @ApiProperty({ enum: ['closed', 'maintenance', 'private'] })
  @IsIn(['closed', 'maintenance', 'private'])
  kind: 'closed' | 'maintenance' | 'private';

  @ApiPropertyOptional({ example: 'Christmas Day' })
  @IsOptional() @IsString() @IsSafeText() @MaxLength(120)
  reason?: string;
}

export class SessionPlanDto {
  @ApiProperty({ example: ['09:30', '10:30', '14:00'] })
  @IsArray() @ArrayMaxSize(48) @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { each: true })
  times: string[];

  @ApiPropertyOptional({ description: 'Guests (per-person) or units (vehicles) per session; null = no limit' })
  @IsOptional() @IsInt() @Min(0) @Max(5000)
  capacity?: number | null;

  @ApiPropertyOptional({ minimum: 5, maximum: 600, default: 60 })
  @IsOptional() @IsInt() @Min(5) @Max(600)
  durationMin?: number;
}

export class CalendarDto {
  @ApiPropertyOptional({ description: 'Guests one arrival slot takes, park wide', minimum: 1, maximum: 5000 })
  @IsOptional() @IsInt() @Min(1) @Max(5000)
  slotCapacity?: number;

  @ApiProperty({ type: [ClosureDto] })
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => ClosureDto)
  closures: ClosureDto[];

  @ApiProperty({ description: '{ experienceId: { morning: n | null, afternoon: n | null } }; null = no limit', example: { zipline: { morning: 60, afternoon: 60 }, buggy: { morning: 6, afternoon: 6 } } })
  @IsObject()
  activityCapacity: Record<string, { morning: number | null; afternoon: number | null }>;

  @ApiPropertyOptional({ description: '{ experienceId: { times, capacity, durationMin } }; an experience listed here runs in timed sessions', example: { zipline: { times: ['09:30', '10:30'], capacity: 24, durationMin: 90 } } })
  @IsOptional() @IsObject()
  sessions?: Record<string, { times: string[]; capacity?: number | null; durationMin?: number }>;
}
