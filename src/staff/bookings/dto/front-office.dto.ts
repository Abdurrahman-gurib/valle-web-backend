import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { IsSafeText } from '../../../common/validation';

export const PAYMENT_METHODS = ['cash', 'card', 'juice', 'online', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export class RecordPaymentDto {
  @ApiProperty({ description: 'Rupees taken now (added to what was already paid)', example: 4700 })
  @IsInt() @Min(1) @Max(5_000_000)
  amount: number;

  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsIn(PAYMENT_METHODS)
  method: PaymentMethod;

  @ApiPropertyOptional({ description: "The till's receipt number" })
  @IsOptional() @IsString() @IsSafeText() @MaxLength(40)
  receiptNo?: string;
}

export class PostponeDto {
  @ApiPropertyOptional({ example: 'Heavy rain, park closed at 11:00' })
  @IsOptional() @IsString() @IsSafeText() @MaxLength(200)
  reason?: string;
}
