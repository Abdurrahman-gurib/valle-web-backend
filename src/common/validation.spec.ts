import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateBookingDto } from '../bookings/dto/create-booking.dto';
import { ApplyToVacancyDto } from '../careers/dto/careers.dto';
import { StartSessionDto } from '../chat/dto/chat.dto';
import { CreateVacancyDto, ListApplicationsQueryDto } from '../hr/dto/hr.dto';
import { CreateQuoteDto } from '../quotes/dto/create-quote.dto';
import { ListBookingsQueryDto } from '../staff/bookings/dto/list-bookings.dto';
import { hasControlCharacters, isSuppliedValue, MAX_PAGE } from './validation';

/**
 * Every case here is a payload that used to reach Postgres (or a validator that
 * was handed the wrong type) and came back as a 500 from a public endpoint.
 * They must now fail validation, which the global pipe turns into a 400, while
 * the legitimate payload beside each one keeps passing.
 */

// Written as a code point so no editor or diff can silently eat it.
const NUL = String.fromCharCode(0);

type Ctor<T> = new () => T;

/** Property names that failed validation, mirroring the global pipe's options. */
function failedProps<T extends object>(
  cls: Ctor<T>,
  payload: Record<string, unknown>,
): string[] {
  const instance = plainToInstance(cls, payload, {
    enableImplicitConversion: false,
  });
  return validateSync(instance as object, {
    whitelist: true,
    forbidNonWhitelisted: true,
  }).map((error) => error.property);
}

const validBooking = (): Record<string, unknown> => ({
  visitDate: '2026-08-14',
  slot: 'morning',
  adults: 2,
  kids: 0,
  rate: 'rr',
  items: [{ id: 'zipline', adults: 2 }],
  name: 'A. Peirce',
  payMode: 'gate',
});

const validApplication = (): Record<string, unknown> => ({
  fullName: 'Ariane Leger',
  email: 'ariane@example.com',
});

const validVacancy = (): Record<string, unknown> => ({
  title: 'Zipline guide',
  employment: 'full-time',
  status: 'draft',
});

describe('shared validation helpers', () => {
  it('flags NUL and other C0 controls but allows tab, newline and return', () => {
    expect(hasControlCharacters(`before${NUL}after`)).toBe(true);
    expect(hasControlCharacters(String.fromCharCode(127))).toBe(true);
    expect(hasControlCharacters('line one\nline two\ttabbed\r')).toBe(false);
    expect(hasControlCharacters('Ariane Leger')).toBe(false);
  });

  it('treats only undefined, null and the empty string as "not supplied"', () => {
    expect(isSuppliedValue(undefined)).toBe(false);
    expect(isSuppliedValue(null)).toBe(false);
    expect(isSuppliedValue('')).toBe(false);
    // The object payload must stay inside the validated branch.
    expect(isSuppliedValue({ length: 1 })).toBe(true);
    expect(isSuppliedValue({ length: 0 })).toBe(true);
    expect(isSuppliedValue('guest@example.com')).toBe(true);
  });
});

describe('StartSessionDto email type confusion', () => {
  it.each([{ length: 1 }, { length: 0 }, [], 42])(
    'rejects a non-string email (%p) instead of handing it to IsEmail',
    (email: unknown) => {
      expect(
        failedProps(StartSessionDto, { visitorKey: 'v-8f3c21ab', email }),
      ).toContain('email');
    },
  );

  it('still accepts an omitted, empty or real email', () => {
    expect(failedProps(StartSessionDto, { visitorKey: 'v-8f3c21ab' })).toEqual(
      [],
    );
    expect(
      failedProps(StartSessionDto, { visitorKey: 'v-8f3c21ab', email: '' }),
    ).toEqual([]);
    expect(
      failedProps(StartSessionDto, {
        visitorKey: 'v-8f3c21ab',
        email: 'guest@example.com',
        name: 'A. Peirce',
      }),
    ).toEqual([]);
  });

  it('rejects a NUL byte in the visitor name or the chat email', () => {
    expect(
      failedProps(StartSessionDto, {
        visitorKey: 'v-8f3c21ab',
        name: `A.${NUL} Peirce`,
      }),
    ).toContain('name');
  });
});

describe('control characters on public write paths', () => {
  it('rejects a NUL byte anywhere in a quote', () => {
    expect(
      failedProps(CreateQuoteDto, {
        name: 'A. Peirce',
        email: 'sales@example.com',
        message: `Team${NUL} building`,
      }),
    ).toContain('message');

    expect(
      failedProps(CreateQuoteDto, {
        name: `A.${NUL}Peirce`,
        email: 'sales@example.com',
      }),
    ).toContain('name');
  });

  it('accepts a quote with normal text, including newlines', () => {
    expect(
      failedProps(CreateQuoteDto, {
        name: 'A. Peirce',
        company: 'Advenature Co Ltd',
        email: 'sales@example.com',
        phone: '+230 5292 8841',
        groupSize: '25 to 50',
        preferredDate: '2026-09-12',
        message: 'Team building day.\nTwo groups, please.',
      }),
    ).toEqual([]);
  });

  it('rejects a NUL byte in a job application and in a booking name', () => {
    expect(
      failedProps(ApplyToVacancyDto, {
        ...validApplication(),
        coverLetter: `I would${NUL} like to apply`,
      }),
    ).toContain('coverLetter');

    expect(
      failedProps(CreateBookingDto, {
        ...validBooking(),
        name: `A.${NUL}Peirce`,
      }),
    ).toContain('name');
  });

  it('accepts the legitimate application and booking payloads', () => {
    expect(failedProps(ApplyToVacancyDto, validApplication())).toEqual([]);
    expect(failedProps(CreateBookingDto, validBooking())).toEqual([]);
  });
});

describe('page bounds', () => {
  it.each(['1e20', 1e20, Number.MAX_SAFE_INTEGER, MAX_PAGE + 1])(
    'rejects page=%p, which would overflow the SQL OFFSET',
    (page: string | number) => {
      expect(failedProps(ListBookingsQueryDto, { page })).toContain('page');
      expect(failedProps(ListApplicationsQueryDto, { page })).toContain('page');
    },
  );

  it('still accepts a page a human could ask for', () => {
    expect(failedProps(ListBookingsQueryDto, { page: '3', pageSize: '25' })).toEqual(
      [],
    );
    expect(failedProps(ListBookingsQueryDto, { page: MAX_PAGE })).toEqual([]);
    expect(failedProps(ListApplicationsQueryDto, { page: 1 })).toEqual([]);
  });

  it('keeps rejecting page below 1', () => {
    expect(failedProps(ListBookingsQueryDto, { page: 0 })).toContain('page');
  });
});

describe('calendar-invalid dates', () => {
  it('rejects a day that does not exist on the booking list filters', () => {
    expect(failedProps(ListBookingsQueryDto, { from: '2026-02-30' })).toContain(
      'from',
    );
    expect(failedProps(ListBookingsQueryDto, { to: '2026-09-31' })).toContain(
      'to',
    );
  });

  it('rejects a day that does not exist on a vacancy closing date', () => {
    expect(
      failedProps(CreateVacancyDto, {
        ...validVacancy(),
        closesOn: '2026-02-30',
      }),
    ).toContain('closesOn');
  });

  it('rejects a day that does not exist on a booking visit date', () => {
    expect(
      failedProps(CreateBookingDto, { ...validBooking(), visitDate: '2026-02-30' }),
    ).toContain('visitDate');
  });

  it('rejects a truncated ISO value that would slice into a date column', () => {
    expect(
      failedProps(CreateBookingDto, { ...validBooking(), visitDate: '2026-08' }),
    ).toContain('visitDate');
    expect(failedProps(ListBookingsQueryDto, { from: '2026-08' })).toContain(
      'from',
    );
  });

  it('accepts real days, including a leap day and an empty closing date', () => {
    expect(
      failedProps(ListBookingsQueryDto, { from: '2026-08-01', to: '2026-08-31' }),
    ).toEqual([]);
    expect(
      failedProps(CreateBookingDto, { ...validBooking(), visitDate: '2028-02-29' }),
    ).toEqual([]);
    expect(
      failedProps(CreateVacancyDto, {
        ...validVacancy(),
        closesOn: '2026-09-30',
      }),
    ).toEqual([]);
    // The HR form posts '' for "no closing date"; the transform turns it into
    // null, which IsOptional skips.
    expect(
      failedProps(CreateVacancyDto, { ...validVacancy(), closesOn: '' }),
    ).toEqual([]);
  });
});
