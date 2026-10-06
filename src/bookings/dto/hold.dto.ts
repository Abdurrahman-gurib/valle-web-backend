import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsUUID, Matches, Max, Min, ValidateNested } from 'class-validator';
import { BookingItemDto } from './create-booking.dto';

/** Places to hold while the guest fills in their details (POST /bookings/hold). */
export class HoldDto {
  @ApiProperty({ example: '2026-11-20' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  visitDate: string;

  @ApiProperty({ enum: ['morning', 'afternoon'] })
  @IsIn(['morning', 'afternoon'])
  slot: 'morning' | 'afternoon';

  @ApiProperty({ minimum: 1, maximum: 12 })
  @IsInt() @Min(1) @Max(12)
  adults: number;

  @ApiProperty({ minimum: 0, maximum: 12 })
  @IsInt() @Min(0) @Max(12)
  kids: number;

  @ApiProperty({ type: [BookingItemDto] })
  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => BookingItemDto)
  items: BookingItemDto[];

  @ApiPropertyOptional({ description: 'An earlier hold of the same guest, replaced by this one' })
  @IsOptional() @IsUUID()
  holdId?: string;
}
