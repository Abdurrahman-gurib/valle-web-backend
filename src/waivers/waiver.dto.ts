import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsCalendarDate, IsSafeText } from '../common/validation';

/** Every statement must be ticked; the form cannot be sent otherwise. */
export class WaiverDeclarationsDto {
  @ApiProperty() @IsBoolean() @Equals(true) terms: boolean;
  @ApiProperty() @IsBoolean() @Equals(true) health: boolean;
  @ApiProperty() @IsBoolean() @Equals(true) consent: boolean;
}

export class SignWaiverDto {
  @ApiProperty({ example: 'Aisha Rahman' })
  @IsString() @IsSafeText() @IsNotEmpty() @MaxLength(80)
  participantName: string;

  @ApiProperty({ example: '1990-04-12' })
  @IsCalendarDate()
  birthDate: string;

  @ApiProperty({ minimum: 50, maximum: 230 })
  @IsInt() @Min(50) @Max(230)
  heightCm: number;

  @ApiProperty({ minimum: 10, maximum: 250 })
  @IsInt() @Min(10) @Max(250)
  weightKg: number;

  /** Required when the participant is under 18 on the visit date (checked in the service). */
  @ApiPropertyOptional({ example: 'Omar Rahman' })
  @IsOptional() @IsString() @IsSafeText() @MaxLength(80)
  guardianName?: string;

  @ApiPropertyOptional({ example: 'Lux Le Morne' })
  @IsOptional() @IsString() @IsSafeText() @MaxLength(160)
  address?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120)
  email?: string;

  @ApiProperty() @IsString() @Matches(/^[+0-9 ()-]{6,24}$/)
  phone: string;

  @ApiProperty({ example: 'Belgium' }) @IsString() @IsSafeText() @IsNotEmpty() @MaxLength(60)
  nationality: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @IsSafeText() @MaxLength(40)
  idNumber?: string;

  @ApiPropertyOptional({ description: 'Clause 18: promotions by e-mail / phone' }) @IsOptional() @IsBoolean()
  marketingConsent?: boolean;

  @ApiProperty() @IsString() @IsSafeText() @IsNotEmpty() @MaxLength(80)
  emergencyName: string;

  @ApiProperty() @IsString() @Matches(/^[+0-9 ()-]{6,24}$/)
  emergencyPhone: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @IsSafeText() @MaxLength(500)
  medicalNotes?: string;

  @ApiProperty({ type: WaiverDeclarationsDto })
  @ValidateNested() @Type(() => WaiverDeclarationsDto)
  declarations: WaiverDeclarationsDto;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  photoConsent?: boolean;

  /** PNG data URL of the finger signature, drawn on the phone. */
  @ApiProperty() @IsString() @Matches(/^data:image\/png;base64,[A-Za-z0-9+/=]{200,90000}$/)
  signature: string;

  @ApiPropertyOptional({ enum: ['en', 'fr', 'de', 'it', 'ar', 'ru', 'es', 'hi'] })
  @IsOptional() @IsIn(['en', 'fr', 'de', 'it', 'ar', 'ru', 'es', 'hi'])
  lang?: string;
}

export class CheckInDto {
  /** Check in although waivers are missing or flagged; recorded in the audit trail. */
  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  override?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString() @IsSafeText() @MaxLength(200)
  reason?: string;
}
