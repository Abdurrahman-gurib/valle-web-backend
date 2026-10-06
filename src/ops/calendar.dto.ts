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
}
