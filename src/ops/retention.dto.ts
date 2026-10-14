import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional } from 'class-validator';

/** Periods to change; bounds are checked by the service (retention.policy.ts RETENTION_BOUNDS). */
export class RetentionPolicyDto {
  @ApiPropertyOptional({ example: 12 }) @IsOptional() @IsInt() chatMonths?: number;
  @ApiPropertyOptional({ example: 24 }) @IsOptional() @IsInt() quoteMonths?: number;
  @ApiPropertyOptional({ example: 24 }) @IsOptional() @IsInt() tableReservationMonths?: number;
  @ApiPropertyOptional({ example: 12 }) @IsOptional() @IsInt() applicationMonths?: number;
  @ApiPropertyOptional({ example: 12 }) @IsOptional() @IsInt() photoMonths?: number;
  @ApiPropertyOptional({ example: 7 }) @IsOptional() @IsInt() bookingYears?: number;
}
