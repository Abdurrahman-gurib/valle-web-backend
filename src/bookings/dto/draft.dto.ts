import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsObject, MaxLength } from 'class-validator';

/** POST /bookings/draft: the page state to keep, and where to send the link. */
export class SaveDraftDto {
  @ApiProperty({ example: 'asha@example.com' })
  @IsEmail() @MaxLength(160)
  email: string;

  @ApiProperty({ description: 'The booking page state (cart, party, date, slot, details); at most 16 KB' })
  @IsObject()
  payload: Record<string, unknown>;
}
