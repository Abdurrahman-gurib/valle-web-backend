import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  IsCalendarDate,
  IsSafeText,
  isSuppliedValue,
} from '../../common/validation';

export class BookingItemDto {
  @ApiProperty({ example: 'zipline' })
  @IsString()
  @IsSafeText()
  @IsNotEmpty()
  id: string;

  /** A price_list label of this experience (e.g. one zipline tour); omitted = base price. */
  @ApiPropertyOptional({ example: 'Advenature Flight · 5.5 km, 11 lines' })
  @IsOptional()
  @IsString()
  @IsSafeText()
  @MaxLength(120)
  variant?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 12, example: 2 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(12)
  adults?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 12, example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(12)
  kids?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 12, example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(12)
  units?: number;
}

export class CreateBookingDto {
  @ApiProperty({ example: '2026-08-14', description: 'ISO visit date' })
  // IsDateString alone accepts partial ISO ("2026-08"), whose slice(0, 10) would
  // reach the date column malformed; strict mode rejects calendar-invalid days.
  // Same pair of rules as every other date field, via the shared decorator.
  @IsCalendarDate({ allowTime: true })
  visitDate: string;

  @ApiProperty({ enum: ['morning', 'afternoon'] })
  @IsIn(['morning', 'afternoon'])
  slot: 'morning' | 'afternoon';

  @ApiProperty({ minimum: 1, maximum: 12, example: 2 })
  @IsInt()
  @Min(1)
  @Max(12)
  adults: number;

  @ApiProperty({ minimum: 0, maximum: 12, example: 1 })
  @IsInt()
  @Min(0)
  @Max(12)
  kids: number;

  @ApiProperty({ enum: ['rr', 'nr'], description: 'rr = resident, nr = non-resident' })
  @IsIn(['rr', 'nr'])
  rate: 'rr' | 'nr';

  @ApiProperty({ type: [BookingItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookingItemDto)
  items: BookingItemDto[];

  @ApiProperty({ example: 'A. Peirce', maxLength: 120 })
  @IsString()
  @IsSafeText()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ example: '+230 5292 8841' })
  @IsOptional()
  @IsString()
  @IsSafeText()
  @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional({ example: 'guest@example.com' })
  // '' means "the guest left the box empty"; anything else, including a
  // non-string, is validated so @IsString() can turn it into a 400.
  @ValidateIf((o: CreateBookingDto) => isSuppliedValue(o.email))
  @IsString()
  @IsSafeText()
  @IsEmail()
  @MaxLength(160)
  email?: string;

  @ApiPropertyOptional({ example: 'Mauritius' })
  @IsOptional()
  @IsString()
  @IsSafeText()
  @MaxLength(80)
  nationality?: string;

  @ApiProperty({ enum: ['gate', 'online'] })
  @IsIn(['gate', 'online'])
  payMode: 'gate' | 'online';
}
