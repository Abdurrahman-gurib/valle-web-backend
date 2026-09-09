import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { IsSafeText } from '../../common/validation';

/**
 * Public, unauthenticated payload. Every string is carried straight into a
 * Postgres text column, so each one is also checked for control characters:
 * a NUL byte anywhere used to escape the driver as a 500 instead of a 400.
 */
export class CreateQuoteDto {
  @ApiProperty({ example: 'A. Peirce', maxLength: 120 })
  @IsString()
  @IsSafeText()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ example: 'Advenature Co Ltd' })
  @IsOptional()
  @IsString()
  @IsSafeText()
  @MaxLength(160)
  company?: string;

  @ApiProperty({ example: 'sales@example.com' })
  @IsString()
  @IsSafeText()
  @IsEmail()
  @MaxLength(160)
  email: string;

  @ApiPropertyOptional({ example: '+230 5292 8841' })
  @IsOptional()
  @IsString()
  @IsSafeText()
  @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional({ example: '25 to 50' })
  @IsOptional()
  @IsString()
  @IsSafeText()
  @MaxLength(40)
  groupSize?: string;

  // Free text on purpose: the form lets a visitor write "mid September", and
  // nothing downstream parses it as a date.
  @ApiPropertyOptional({ example: '2026-09-12' })
  @IsOptional()
  @IsString()
  @IsSafeText()
  @MaxLength(40)
  preferredDate?: string;

  @ApiPropertyOptional({ example: 'Team building day for our sales team.' })
  @IsOptional()
  @IsString()
  @IsSafeText()
  @MaxLength(4000)
  message?: string;
}
