import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';
import { IsCalendarDate, IsSafeText } from '../../common/validation';

/** Today in Mauritius as YYYY-MM-DD (the park's calendar, whatever the server's zone). */
export function mauritiusToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Indian/Mauritius', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/**
 * A preferred date that has not passed. One day of grace below Mauritius'
 * today, so a visitor whose own calendar is still on "yesterday" (UTC-x)
 * can pick their today. Shape and reality are checked by IsCalendarDate.
 */
export function IsNotPastDate(options?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isNotPastDate',
      target: object.constructor,
      propertyName: propertyName as string,
      options: { message: '$property must be today or a later date', ...options },
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return true; // the shape rule reports it
          const today = new Date(mauritiusToday() + 'T00:00:00Z');
          const grace = new Date(today.getTime() - 86_400_000).toISOString().slice(0, 10);
          return value >= grace;
        },
      },
    });
  };
}

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

  // The form's date picker sends YYYY-MM-DD: a real day, today or later.
  // (An empty string means "no date yet" and is treated as absent.)
  @ApiPropertyOptional({ example: '2026-09-12', description: 'YYYY-MM-DD, today or later' })
  @IsOptional()
  @IsString()
  @IsCalendarDate()
  @IsNotPastDate()
  preferredDate?: string;

  // The programme or package the visitor chose on the page ("Programme 2 ·
  // Team spirit"); stored at the head of the message for the desk.
  @ApiPropertyOptional({ example: 'Corporate package · Programme 1', maxLength: 160 })
  @IsOptional()
  @IsString()
  @IsSafeText()
  @MaxLength(160)
  programme?: string;

  @ApiPropertyOptional({ example: 'Team building day for our sales team.' })
  @IsOptional()
  @IsString()
  @IsSafeText()
  @MaxLength(4000)
  message?: string;
}
