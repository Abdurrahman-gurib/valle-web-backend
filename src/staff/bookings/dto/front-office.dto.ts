import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { IsSafeText } from '../../../common/validation';

export const PAYMENT_METHODS = ['cash', 'card', 'juice', 'online', 'transfer', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export class RefundDto {
  @ApiProperty({ description: 'Rupees to send back through the payment provider', example: 1500 })
  @IsInt() @Min(1) @Max(5_000_000)
  amount: number;

  @ApiPropertyOptional({ description: 'Why (shown in the trail)' })
  @IsOptional() @IsString() @IsSafeText() @MaxLength(200)
  reason?: string;
}

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
  @ApiProperty({ example: 'Heavy rain, park closed at 11:00', minLength: 3 })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString() @IsSafeText() @MinLength(3, { message: 'Give a reason for the postponement (at least 3 characters)' }) @MaxLength(200)
  reason: string;
}
