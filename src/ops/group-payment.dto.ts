import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { IsSafeText } from '../common/validation';

/** How schools and groups pay their deposit (bank transfer details), shown on their confirmation and ticket. */
export class GroupPaymentDto {
  @ApiProperty({ description: 'Bank name, account name, account number, IBAN / SWIFT and the reference to quote. Empty = the team sends the details by e-mail.', maxLength: 1000 })
  @IsString() @IsSafeText() @MaxLength(1000)
  bankDetails: string;
}
