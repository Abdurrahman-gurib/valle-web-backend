import { applyDecorators } from '@nestjs/common';
import {
  IsDateString,
  Matches,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

/**
 * Validation rules that more than one module needs, kept in one place so a
 * hardening decision is made once instead of drifting per DTO.
 *
 * Three problems are solved here, all of which used to surface as a 500 from a
 * public endpoint rather than as a 400:
 *
 *  1. control characters (NUL above all) reaching a Postgres text column, which
 *     the driver rejects at the protocol level;
 *  2. `page` numbers large enough to overflow the SQL OFFSET;
 *  3. date strings that are the right SHAPE but not a real day (2026-02-30).
 *
 * The policy for (1) is to REJECT with a 400, never to silently strip: a
 * payload carrying a NUL byte is not a payload the caller meant to send, and
 * quietly rewriting it would hide the problem from both sides.
 */

/**
 * Upper bound for any `page` query param. Postgres OFFSET is a bigint, but the
 * value first passes through JS numbers, and nobody pages past 10k rows of a
 * back-office list; anything beyond this is a probe, not a user.
 */
export const MAX_PAGE = 10000;

/** Tab, line feed and carriage return stay legal inside a message. */
const ALLOWED_CONTROL_CODES: ReadonlySet<number> = new Set([9, 10, 13]);

const DELETE_CODE = 127;
const FIRST_PRINTABLE_CODE = 32;

/** A plain calendar day, nothing else. */
export const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A calendar day, optionally followed by a time. Needed because IsDateString
 * accepts a truncated ISO value such as "2026-08", whose first ten characters
 * would reach a date column malformed.
 */
export const CALENDAR_DATE_PREFIX_PATTERN = /^\d{4}-\d{2}-\d{2}($|T)/;

/**
 * True when the value carries a C0 control character or DEL, the class of
 * character Postgres refuses (NUL) or that has no business in a form field.
 * Written as a code-point scan rather than a regex so the banned range is
 * readable and cannot be misread as an escaping accident.
 */
export function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (ALLOWED_CONTROL_CODES.has(code)) continue;
    if (code < FIRST_PRINTABLE_CODE || code === DELETE_CODE) return true;
  }
  return false;
}

/**
 * Predicate for `@ValidateIf` on "optional, but validate it if it is there"
 * fields. It deliberately does NOT test `typeof value === 'string'`: a
 * non-string must stay inside the validated branch so `@IsString()` can reject
 * it with a 400. Reading `.length` off the raw value here is what let an object
 * like `{"length":1}` steer the validators in the first place.
 */
export function isSuppliedValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

/**
 * The value must be a string with no control characters. Pair it with
 * `@IsString()` / `@MaxLength()`; this decorator owns the control-character rule
 * only, and fails closed for any non-string.
 */
export function IsSafeText(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isSafeText',
      target: target.constructor,
      propertyName: propertyName.toString(),
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && !hasControlCharacters(value);
        },
        defaultMessage(): string {
          return '$property must not contain control characters';
        },
      },
    });
  };
}

/**
 * A real day on the calendar, not merely a well-shaped string. `strict` is what
 * turns 2026-02-30 into a 400 instead of a driver error from Postgres.
 *
 * @param options.allowTime accept "YYYY-MM-DDThh:mm..." as well as "YYYY-MM-DD"
 */
export function IsCalendarDate(
  options: { allowTime?: boolean } = {},
): PropertyDecorator {
  const pattern = options.allowTime
    ? CALENDAR_DATE_PREFIX_PATTERN
    : CALENDAR_DATE_PATTERN;
  const shapeMessage = options.allowTime
    ? '$property must start with a full calendar date (YYYY-MM-DD)'
    : '$property must be a date in YYYY-MM-DD form';

  return applyDecorators(
    Matches(pattern, { message: shapeMessage }),
    IsDateString({ strict: true }, { message: '$property must be a real date' }),
  );
}
