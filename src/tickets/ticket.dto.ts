import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class TicketQueryDto {
  @ApiProperty({ description: 'Ticket token from the e-mail / QR link' })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{24}$/)
  t: string;
}
