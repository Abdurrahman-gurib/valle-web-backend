import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEmail, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { IsSafeText } from '../common/validation';

export class PreorderLineDto {
  @ApiProperty({ example: 'Grilled catch of the day' })
  @IsString() @IsSafeText() @IsNotEmpty() @MaxLength(120)
  item: string;

  @ApiProperty({ minimum: 1, maximum: 60 })
  @IsInt() @Min(1) @Max(60)
  qty: number;
}

export class CreateReservationDto {
  @ApiProperty({ example: 'Asha Rahman' })
  @IsString() @IsSafeText() @IsNotEmpty() @MaxLength(120)
  name: string;

  @ApiPropertyOptional()
  @ValidateIf((o: CreateReservationDto) => !!o.email) @IsEmail() @MaxLength(160)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @IsSafeText() @MaxLength(30)
  phone?: string;

  @ApiProperty({ example: '2026-11-20' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  visitDate: string;

  @ApiProperty({ example: '12:30' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  visitTime: string;

  @ApiProperty({ minimum: 1, maximum: 60 })
  @IsInt() @Min(1) @Max(60)
  party: number;

  @ApiPropertyOptional({ type: [PreorderLineDto] })
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => PreorderLineDto)
  preorder?: PreorderLineDto[];

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional() @IsString() @IsSafeText() @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ description: 'The park booking this table goes with, if any' })
  @IsOptional() @IsString() @MaxLength(20)
  bookingRef?: string;
}

export class SetReservationStatusDto {
  @ApiProperty({ enum: ['confirmed', 'cancelled'] })
  @IsIn(['confirmed', 'cancelled'])
  status: 'confirmed' | 'cancelled';
}
