import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { CreateBookingDto } from '../../../bookings/dto/create-booking.dto';

export const BOOKING_CHANNELS = ['phone', 'desk', 'email', 'whatsapp', 'agency', 'other'] as const;
export type BookingChannel = (typeof BOOKING_CHANNELS)[number];

/** A booking an operator takes on a guest's behalf: the public payload plus how it came in. */
export class CreateStaffBookingDto extends CreateBookingDto {
  @ApiProperty({ enum: BOOKING_CHANNELS })
  @IsIn(BOOKING_CHANNELS)
  channel: BookingChannel;

  @ApiPropertyOptional({ maxLength: 500, description: 'Internal note (deposit, special request...)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
