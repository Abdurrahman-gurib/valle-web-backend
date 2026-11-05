import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsObject, IsOptional, MaxLength } from 'class-validator';
import { BOOKING_LANGS } from './create-booking.dto';

/** POST /bookings/draft: the page state to keep, and where to send the link. */
export class SaveDraftDto {
  @ApiProperty({ example: 'asha@example.com' })
  @IsEmail() @MaxLength(160)
  email: string;

  @ApiProperty({ description: 'The booking page state (cart, party, date, slot, details); at most 16 KB' })
  @IsObject()
  payload: Record<string, unknown>;

  @ApiPropertyOptional({ enum: BOOKING_LANGS, description: 'The page language: the e-mail is written in it and its link opens in it' })
  @IsOptional()
  @IsIn(BOOKING_LANGS)
  lang?: string;
}
