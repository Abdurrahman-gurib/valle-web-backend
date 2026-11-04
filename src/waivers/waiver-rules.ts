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
  /** How many of the party the booking puts on it (largest line); absent = everyone. */
  people?: { adults: number; kids: number };
}

/** A ride the gate checks once for the party: who of them is on it is not known. */
export interface GateCheck { activity: string; message: string }

/** "age 12+", "ages 3–12", "drivers 16+", or the weight / height limits. */
export function limitsText(l: ActivityLimits): string {
  const parts: string[] = [];
  if (l.minAge !== undefined && l.maxAge !== undefined) parts.push(`ages ${l.minAge}–${l.maxAge}`);
  else if (l.minAge !== undefined) parts.push(`age ${l.minAge}+`);
  else if (l.maxAge !== undefined) parts.push(`age up to ${l.maxAge}`);
  if (l.driveMinAge !== undefined) parts.push(`drivers ${l.driveMinAge}+`);
  if (l.minWeightKg !== undefined || l.maxWeightKg !== undefined) parts.push(`weight ${l.minWeightKg ?? 0}–${l.maxWeightKg ?? '∞'} kg`);
  if (l.minHeightCm !== undefined || l.maxHeightCm !== undefined) parts.push(`height ${l.minHeightCm ?? 0}–${l.maxHeightCm ?? '∞'} cm`);
  return parts.join(', ');
}

/** Is this activity's line only part of an age band, so per-person checks cannot be made? */
export function partialOn(a: GateActivity, party: { adults: number; kids: number }): boolean {
  if (!a.people) return false;
  const { adults, kids } = a.people;
  return (adults > 0 && adults < party.adults) || (kids > 0 && kids < party.kids) || kids > party.kids;
}

/**
 * The rides the gate checks once for the party (listed once each, never per
 * waiver): those whose line counts only part of the party.
 */
export function gateChecks(activities: GateActivity[], party: { adults: number; kids: number; infants?: number | null }): GateCheck[] {
  const total = party.adults + party.kids + (party.infants ?? 0);
  return activities.filter((a) => partialOn(a, party)).map((a) => {
    const n = (a.people?.adults ?? 0) + (a.people?.kids ?? 0);
    const what = limitsText(a.limits);
    return { activity: a.name, message: `${a.name} · ${n} of ${total} people booked: check ${what || 'the limits'} at the gate` };
  });
}

/** The activities a participant of this age is certainly on (unknown ones go to gateChecks). */
export function activitiesOf(age: number, activities: GateActivity[], party: { adults: number; kids: number }): GateActivity[] {
  return activities.filter((a) => !a.people || onLine(age, a.people, party) === 'yes');
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

/** Default set of activities that need a signed Disclaimer Form (settings row `waiver_activities` overrides). */
export const DEFAULT_WAIVER_ACTIVITIES = ['zipline', 'bicycle', 'nepalese', 'quad', 'buggy', 'luge'];

export function parseWaiverActivities(value: string | undefined): string[] {
  if (!value) return DEFAULT_WAIVER_ACTIVITIES;
  try {
    const v = JSON.parse(value) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : DEFAULT_WAIVER_ACTIVITIES;
  } catch {
    return DEFAULT_WAIVER_ACTIVITIES;
  }
}

/** A booked line as the waiver rules read it. */
export interface WaiverLine { experienceId: string | null; productKey?: string | null; adults: number; kids: number; units: number }
export interface WaiverParty { adults: number; kids: number; infants?: number | null; groupKind?: string | null }

/** The experiences a line puts people on: its own, or what its package contains. */
export function lineActivities(l: WaiverLine, productActs?: ReadonlyMap<string, string[]>): string[] {
  if (l.experienceId) return [l.experienceId];
  if (l.productKey) return productActs?.get(l.productKey) ?? [];
  return [];
}

/**
 * How many people must sign: the largest party on any line that needs a
 * waiver (a flat-priced line such as a buggy counts the whole party; a package
 * line counts through what it contains), plus every child under 6, whom a
 * parent signs for. Walks, expeditions, restaurants, Kids Park, animal feeding
 * and park entry need none.
 */
export function waiverRequiredCount(
  lines: WaiverLine[],
  waiverActivities: string[],
  party: WaiverParty,
  productActs?: ReadonlyMap<string, string[]>,
): number {
  // A group: the teacher / leader always signs one waiver pack naming the participants
  // (the park's disclaimer covers the visit itself, not only the listed activities).
  if (party.groupKind) return 1;
  let n = 0;
  for (const l of lines) {
    if (!lineActivities(l, productActs).some((id) => waiverActivities.includes(id))) continue;
    const people = l.adults + l.kids > 0 ? l.adults + l.kids : party.adults + party.kids;
    n = Math.max(n, people);
  }
  if (n === 0) return 0;
  return Math.min(n, party.adults + party.kids) + (party.infants ?? 0);
}

/**
 * Experiences named in a package's wording ("Mountain Luge Kart (1 ride)",
 * "Nepalese Bridge OR Bicycle Zipline", "The Discovery Tour (1.6 km · 7 lines)").
 * Each segment takes the first rule that matches, most specific first, so a
 * "Bicycle Zipline" is the bicycle and never also the zipline.
 */
const PACKAGE_RULES: [RegExp, string][] = [
  [/bonding|roller coaster zipline/, 'bonding'],
  [/roller coaster/, 'coaster'],
  [/pirate/, 'pirate'],
  [/excavator/, 'miniexc'],
  [/mini[ -]?quad/, 'miniquad'],
  [/bicycle/, 'bicycle'],
  [/giant swing/, 'giantswing'],
  [/luge/, 'luge'],
  [/nepalese/, 'nepalese'],
  [/buggy|buggies/, 'buggy'],
  [/quad/, 'quad'],
  [/\bpeak\b/, 'peak'],
  [/zip|flight|discovery tour|sky pulse|plunge/, 'zipline'],
];

export function packageActivityIds(texts: string[], experiences: { id: string; name: string }[] = []): string[] {
  const out = new Set<string>();
  for (const text of texts) {
    for (const seg of (text ?? '').toLowerCase().split(/,|\bor\b|\//)) {
      const s = seg.trim();
      if (!s) continue;
      const rule = PACKAGE_RULES.find(([re]) => re.test(s));
      if (rule) { out.add(rule[1]); continue; }
      const exp = experiences.find((e) => e.name.length > 3 && s.includes(e.name.toLowerCase()));
      if (exp) out.add(exp.id);
    }
  }
  return [...out];
}

/** Is a person of this age on a line? 'unknown' when the line counts only part of their age band. */
export function onLine(age: number, l: { adults: number; kids: number }, party: { adults: number; kids: number }): 'yes' | 'no' | 'unknown' {
  if (age >= 12) {
    if (l.adults <= 0) return 'no';
    return l.adults >= party.adults ? 'yes' : 'unknown';
  }
  if (age >= 6) {
    if (l.kids <= 0) return 'no';
    return l.kids >= party.kids ? 'yes' : 'unknown';
  }
  // under 6: only a line counting more children than the 6–11s can include them
  if (l.kids <= party.kids) return 'no';
  return 'unknown';
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
