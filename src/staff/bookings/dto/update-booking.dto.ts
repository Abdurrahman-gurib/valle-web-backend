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
import { BOOKING_STATUSES, BookingStatus } from './list-bookings.dto';

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
}
