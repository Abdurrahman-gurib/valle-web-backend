/**
 * Data retention periods (privacy policy, "How long we keep it"). Stored as the
 * `retention` settings row (JSON); anything missing or out of bounds falls back
 * to the default, so a bad row can never shorten a period below the floor.
 */
export interface RetentionPolicy {
  /** Chat conversations, their messages and attachments, after the last message. */
  chatMonths: number;
  /** Group / corporate quote requests, after they came in. */
  quoteMonths: number;
  /** Restaurant table reservations, after the reserved date. */
  tableReservationMonths: number;
  /** Job applications, after the decision (rejected / hired) or the vacancy closing. */
  applicationMonths: number;
  /** Visit photos uploaded to a booking, after the visit. */
  photoMonths: number;
  /** Bookings and waivers are ANONYMISED (never deleted) this many years after the visit. */
  bookingYears: number;
}

export const RETENTION_DEFAULTS: RetentionPolicy = {
  chatMonths: 12,
  quoteMonths: 24,
  tableReservationMonths: 24,
  applicationMonths: 12,
  photoMonths: 12,
  // Mauritius: accounting records are kept at least 7 years.
  bookingYears: 7,
};

/** Inclusive bounds a manager may set. The booking floor is the accounting minimum. */
export const RETENTION_BOUNDS: Record<keyof RetentionPolicy, { min: number; max: number }> = {
  chatMonths: { min: 1, max: 60 },
  quoteMonths: { min: 6, max: 120 },
  tableReservationMonths: { min: 6, max: 120 },
  applicationMonths: { min: 1, max: 60 },
  photoMonths: { min: 1, max: 60 },
  bookingYears: { min: 7, max: 15 },
};

export const RETENTION_KEYS = Object.keys(RETENTION_DEFAULTS) as (keyof RetentionPolicy)[];

export function inBounds(key: keyof RetentionPolicy, v: unknown): v is number {
  const b = RETENTION_BOUNDS[key];
  return typeof v === 'number' && Number.isInteger(v) && v >= b.min && v <= b.max;
}

/** Reads the settings value; invalid or missing fields take the default. */
export function parsePolicy(raw: string | null | undefined): RetentionPolicy {
  let obj: Record<string, unknown> = {};
  try {
    const p = raw ? JSON.parse(raw) : {};
    if (p && typeof p === 'object' && !Array.isArray(p)) obj = p;
  } catch {
    /* defaults */
  }
  const out = { ...RETENTION_DEFAULTS };
  for (const k of RETENTION_KEYS) if (inBounds(k, obj[k])) out[k] = obj[k] as number;
  return out;
}

/** Problems with a proposed change (empty = valid). */
export function policyProblems(patch: Partial<Record<keyof RetentionPolicy, unknown>>): string[] {
  const problems: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!(RETENTION_KEYS as string[]).includes(k)) { problems.push(`unknown period ${k}`); continue; }
    if (v === undefined) continue;
    const key = k as keyof RetentionPolicy;
    if (!inBounds(key, v)) problems.push(`${k} must be a whole number between ${RETENTION_BOUNDS[key].min} and ${RETENTION_BOUNDS[key].max}`);
  }
  return problems;
}

/** The park runs on Mauritius time (UTC+4, no DST). */
const PARK_OFFSET_MS = 4 * 3600_000;

/** Calendar subtraction in whole months, clamped to the month end (31 Mar - 1 month = 28/29 Feb). */
export function minusMonths(d: Date, months: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() - months;
  const target = new Date(Date.UTC(y, m, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return target;
}

/** YYYY-MM-DD of the park-local day `months` before now: visit dates strictly before it are past retention. */
export function parkDateCutoff(now: Date, months: number): string {
  const local = new Date(now.getTime() + PARK_OFFSET_MS);
  return minusMonths(local, months).toISOString().slice(0, 10);
}

export interface RetentionCutoffs {
  /** timestamptz: last activity / decision strictly before this is past retention */
  chatBefore: Date;
  quoteBefore: Date;
  applicationBefore: Date;
  /** date (YYYY-MM-DD): visit dates strictly before this */
  tableReservationBefore: string;
  photoVisitBefore: string;
  bookingVisitBefore: string;
  /** expired drafts / holds: expires_at strictly before now */
  expiredBefore: Date;
}

export function cutoffs(policy: RetentionPolicy, now: Date): RetentionCutoffs {
  return {
    chatBefore: minusMonths(now, policy.chatMonths),
    quoteBefore: minusMonths(now, policy.quoteMonths),
    applicationBefore: minusMonths(now, policy.applicationMonths),
    tableReservationBefore: parkDateCutoff(now, policy.tableReservationMonths),
    photoVisitBefore: parkDateCutoff(now, policy.photoMonths),
    bookingVisitBefore: parkDateCutoff(now, policy.bookingYears * 12),
    expiredBefore: now,
  };
}
