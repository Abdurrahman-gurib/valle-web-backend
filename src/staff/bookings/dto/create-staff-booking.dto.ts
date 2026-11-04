import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { DeskPaymentDto } from './front-office.dto';
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

  /** Money taken at the desk in the same step (a cash walk-in); recorded like the cashier's payment. */
  @ApiPropertyOptional({ type: DeskPaymentDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DeskPaymentDto)
  payment?: DeskPaymentDto;
}
