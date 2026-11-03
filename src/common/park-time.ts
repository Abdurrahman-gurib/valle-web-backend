/** The park's time zone: every "today" and visit date is a Mauritius calendar day. */
export const PARK_TZ = 'Indian/Mauritius';

/** Today at the park, as YYYY-MM-DD. */
export const parkToday = (): string => new Date().toLocaleDateString('en-CA', { timeZone: PARK_TZ });

/**
 * The park's wall clock as a Date whose local fields (getHours() and so on)
 * read Mauritius time. Only for comparing hours of the day, never for storing.
 */
export const parkNow = (): Date => new Date(new Date().toLocaleString('en-US', { timeZone: PARK_TZ }));

/** "30/09/2026, 12:00:00" in park time: how signatures are stamped on waivers. */
export const parkDateTime = (d: Date): string => d.toLocaleString('en-GB', { timeZone: PARK_TZ, hour12: false });

/**
 * A `date` column (or the date part of a timestamp) as YYYY-MM-DD. The driver
 * hands `date` columns over as strings; a Date is read in UTC.
 */
export const isoDay = (value: string | Date): string =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

/** Same, for a nullable column. */
export const isoDayOrNull = (value: string | Date | null | undefined): string | null =>
  value == null ? null : isoDay(value);

/**
 * A `date` column as YYYY-MM-DD for the careers pages, which read a parsed
 * Date in the server's own zone rather than UTC.
 */
export const localIsoDayOrNull = (value: string | Date | null): string | null => {
  if (value === null) return null;
  return value instanceof Date ? value.toLocaleDateString('en-CA') : String(value).slice(0, 10);
};

/** A timestamp column as ISO 8601. */
export const toIso = (value: string | Date): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

/** Calendar arithmetic on YYYY-MM-DD days (UTC, so no DST surprises): addDays('2026-02-28', 1) = '2026-03-01'. */
export const addDays = (day: string, n: number): string => {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Day of the week of a YYYY-MM-DD day, 0 = Sunday. */
export const weekday = (day: string): number => new Date(day + 'T00:00:00Z').getUTCDay();

/** First day of the month of a YYYY-MM-DD day. */
export const startOfMonth = (day: string): string => `${day.slice(0, 7)}-01`;

/** First day of the following month of a YYYY-MM-DD day. */
export const startOfNextMonth = (day: string): string => {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  return month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, '0')}-01`;
};

/** "Friday, 2 October 2026" for a YYYY-MM-DD day (read at noon UTC, so the day never shifts). */
export const longDate = (day: string): string =>
  new Date(day + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "02/10/2026" for a date column: how receipts and waiver PDFs print days. */
export const dayMonthYear = (value: string | Date): string => {
  const [y, m, d] = isoDay(value).split('-');
  return `${d}/${m}/${y}`;
};
