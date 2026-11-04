import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, ValidateNested } from 'class-validator';
import { IsSafeText } from '../../../common/validation';
import { BOOKING_STATUSES, BookingStatus } from './list-bookings.dto';
import { BookingItemDto } from '../../../bookings/dto/create-booking.dto';
import { ADJUSTMENT_KINDS, type AdjustmentKind } from '../../../bookings/pricing';

/**
 * A staff edit of one reservation. Every field is optional, but the service
 * rejects a body that carries none of them (400).
 *
 * There is deliberately NO money field here: `entryAmount`, `subtotal`,
 * `discount` and `total` are recomputed server-side from the booking's own
 * experience lines whenever the party or the rate moves. The global
 * `whitelist: true` pipe strips a client-sent `total` before this DTO is even
 * built, so it can never reach the database.
 *
 * Validation mirrors CreateBookingDto so a booking cannot be edited into a
 * state the public form would have refused to create.
 */
export class UpdateBookingDto {
  @ApiPropertyOptional({ example: '2026-08-14', description: 'ISO visit date' })
  @IsOptional()
  // IsDateString alone accepts a partial ISO string ("2026-08"), whose
  // slice(0, 10) would reach the date column malformed.
  @Matches(/^\d{4}-\d{2}-\d{2}($|T)/, {
    message: 'visitDate must start with a full calendar date (YYYY-MM-DD)',
  })
  @IsDateString({ strict: true })
  visitDate?: string;

  @ApiPropertyOptional({ enum: ['morning', 'afternoon'] })
  @IsOptional()
  @IsIn(['morning', 'afternoon'])
  slot?: 'morning' | 'afternoon';

  @ApiPropertyOptional({ minimum: 1, maximum: 12, example: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  adults?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 12, example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(12)
  kids?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 12, example: 1, description: 'Children under 6' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(12)
  infants?: number;

  @ApiPropertyOptional({
    enum: ['rr', 'nr'],
    description: 'rr = resident, nr = non-resident',
  })
  @IsOptional()
  @IsIn(['rr', 'nr'])
  rate?: 'rr' | 'nr';

  @ApiPropertyOptional({ example: 'A. Peirce', maxLength: 120 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  guestName?: string;

  @ApiPropertyOptional({ example: '+230 5292 8841' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional({
    example: 'guest@example.com',
    description: 'An empty string clears the address',
  })
  // An operator must be able to clear a wrong address, so '' skips IsEmail.
  @ValidateIf((o: UpdateBookingDto) => o.email !== undefined && o.email !== '')
  @IsEmail()
  @MaxLength(160)
  email?: string;

  @ApiPropertyOptional({ example: 'Mauritius' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  nationality?: string;

  @ApiPropertyOptional({ enum: ['gate', 'online'] })
  @IsOptional()
  @IsIn(['gate', 'online'])
  payMode?: 'gate' | 'online';

  @ApiPropertyOptional({ enum: BOOKING_STATUSES })
  @IsOptional()
  @IsIn(BOOKING_STATUSES)
  status?: BookingStatus;

  @ApiPropertyOptional({
    maxLength: 2000,
    description: 'Internal note, never exposed on a public endpoint',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  staffNote?: string;

  /** The full new list of experience lines (a top-up on the day adds to it); re-priced server-side. */
  @ApiPropertyOptional({ type: [BookingItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookingItemDto)
  items?: BookingItemDto[];

  /** FOC pass, percentage / amount off, free entry; 'none' clears it. */
  @ApiPropertyOptional({ enum: ADJUSTMENT_KINDS })
  @IsOptional()
  @IsIn(ADJUSTMENT_KINDS)
  adjustmentKind?: AdjustmentKind;

  @ApiPropertyOptional({ description: 'percent (1-100) or rupees, per kind' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  adjustmentValue?: number;

  @ApiPropertyOptional({ example: 'FOC pass #12, hotel partner' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  adjustmentNote?: string;

  /** Apply a coupon code (its offer becomes the adjustment); empty string removes it. */
  @ApiPropertyOptional({ example: 'HOTEL10' })
  @IsOptional()
  @IsString()
  @MaxLength(24)
  couponCode?: string;

  /**
   * Optimistic concurrency: the `updatedAt` the operator's screen was showing.
   * When the booking has moved since, the edit is refused with 409 instead of
   * silently overwriting someone else's change.
   */
  @ApiPropertyOptional({ example: '2026-11-04T08:15:02.123Z' })
  @IsOptional()
  @IsDateString({ strict: true })
  expectedUpdatedAt?: string;

  /** Mark arrived although waivers are missing or flagged (the gate's rule); needs `reason`. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  override?: boolean;

  /** Why: a waiver override, a cancellation from the day sheet. Written to the trail, not stored on the booking. */
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @IsSafeText()
  @MaxLength(200)
  reason?: string;
}
