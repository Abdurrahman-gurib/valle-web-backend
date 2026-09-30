/**
 * Pure rules: participant age at the visit, and the warnings the gate shows
 * when a signed waiver does not fit an activity in the booking. Warnings only:
 * the instructor at the platform has the final word.
 */

/** Version of the waiver wording; bump when the text in the frontend changes. */
export const WAIVER_TERMS_VERSION = 'VAL-DISCLAIMER-2026-09-30';

export interface ActivityLimits {
  minAge?: number;
  maxAge?: number;
  /** "16+ DRIVE": younger guests may ride as passengers only */
  driveMinAge?: number;
  minWeightKg?: number;
  maxWeightKg?: number;
  minHeightCm?: number;
  maxHeightCm?: number;
}

export interface GateActivity {
  id: string;
  name: string;
  limits: ActivityLimits;
}

export interface WaiverFlag {
  level: 'stop' | 'check';
  activity: string;
  message: string;
}

/** "8+" -> min 8; "3–12" -> 3..12; "16+ DRIVE" -> drive 16; "ALL AGES" -> none. */
export function parseAgeLabel(label: string | null | undefined): ActivityLimits {
  const s = (label ?? '').toUpperCase();
  const range = s.match(/(\d+)\s*[–-]\s*(\d+)/);
  if (range) return { minAge: Number(range[1]), maxAge: Number(range[2]) };
  const plus = s.match(/(\d+)\s*\+/);
  if (!plus) return {};
  return /DRIVE/.test(s) ? { driveMinAge: Number(plus[1]) } : { minAge: Number(plus[1]) };
}

/** Whole years between the birth date and the visit date (both YYYY-MM-DD). */
export function ageOn(birthDate: string, onDate: string): number {
  const [by, bm, bd] = birthDate.slice(0, 10).split('-').map(Number);
  const [y, m, d] = onDate.slice(0, 10).split('-').map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age--;
  return age;
}

export function flagsFor(
  p: { birthDate: string; heightCm: number; weightKg: number },
  visitDate: string,
  activities: GateActivity[],
): WaiverFlag[] {
  const age = ageOn(p.birthDate, visitDate);
  const out: WaiverFlag[] = [];
  for (const a of activities) {
    const l = a.limits;
    if (l.minAge !== undefined && age < l.minAge) out.push({ level: 'stop', activity: a.name, message: `Age ${age}, minimum ${l.minAge}` });
    if (l.maxAge !== undefined && age > l.maxAge) out.push({ level: 'check', activity: a.name, message: `Age ${age}, made for ${l.minAge ?? 0}–${l.maxAge}` });
    if (l.driveMinAge !== undefined && age < l.driveMinAge) out.push({ level: 'check', activity: a.name, message: `Age ${age}: passenger only, drivers ${l.driveMinAge}+` });
    if (l.maxWeightKg !== undefined && p.weightKg > l.maxWeightKg) out.push({ level: 'stop', activity: a.name, message: `${p.weightKg} kg, maximum ${l.maxWeightKg} kg` });
    if (l.minWeightKg !== undefined && p.weightKg < l.minWeightKg) out.push({ level: 'stop', activity: a.name, message: `${p.weightKg} kg, minimum ${l.minWeightKg} kg` });
    if (l.maxHeightCm !== undefined && p.heightCm > l.maxHeightCm) out.push({ level: 'stop', activity: a.name, message: `${p.heightCm} cm, maximum ${l.maxHeightCm} cm` });
    if (l.minHeightCm !== undefined && p.heightCm < l.minHeightCm) out.push({ level: 'stop', activity: a.name, message: `${p.heightCm} cm, minimum ${l.minHeightCm} cm` });
  }
  return out;
}

/** Settings row `waiver_limits` (JSON), tolerant of a missing or broken value. */
export function parseLimitsSetting(value: string | undefined): Record<string, ActivityLimits> {
  if (!value) return {};
  try {
    const v = JSON.parse(value) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, ActivityLimits> = {};
    for (const [id, raw] of Object.entries(v as Record<string, unknown>)) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;
      const num = (k: string) => (typeof r[k] === 'number' && Number.isFinite(r[k]) ? (r[k] as number) : undefined);
      out[id] = Object.fromEntries(
        (['minWeightKg', 'maxWeightKg', 'minHeightCm', 'maxHeightCm'] as const).map((k) => [k, num(k)]).filter(([, x]) => x !== undefined),
      ) as ActivityLimits;
    }
    return out;
  } catch {
    return {};
  }
}
