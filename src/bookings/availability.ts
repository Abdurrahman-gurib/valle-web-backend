import { addDays, isoDay } from '../common/park-time';
import { activityLevel, closureFor, type Calendar, type ClosureKind, type ExperienceInfo, type SlotKey } from './capacity';

/**
 * Pure part of the date picker's availability: turning grouped booking and
 * hold counts into the levels the public sees. BookingsService runs the SQL.
 */

/** How busy an arrival slot is, for the date picker. */
export type BusyLevel = 'quiet' | 'busy' | 'very-busy' | 'full' | 'closed';
export type ActivityLevel = 'quiet' | 'busy' | 'full';
export interface SlotLoad { bookings: number; guests: number; level: BusyLevel; closure?: { kind: ClosureKind; reason: string } }
export interface AvailabilityDay {
  date: string;
  morning: SlotLoad;
  afternoon: SlotLoad;
  /** Only experiences with a capacity: how full each slot is for them. */
  activities?: Record<string, { morning: ActivityLevel; afternoon: ActivityLevel }>;
  /** Experiences that run in timed sessions: each start time and how full it is. */
  sessions?: Record<string, { durationMin: number; times: Record<string, ActivityLevel> }>;
}

export const AVAILABILITY_MAX_DAYS = 62;

export const SLOTS: readonly SlotKey[] = ['morning', 'afternoon'];

const isSlot = (slot: string): slot is SlotKey => slot === 'morning' || slot === 'afternoon';

export function busyLevel(guests: number, capacity: number): BusyLevel {
  const share = guests / capacity;
  if (share >= 1) return 'full';
  if (share >= 0.7) return 'very-busy';
  if (share >= 0.35) return 'busy';
  return 'quiet';
}

/** The requested window, clamped to 1..AVAILABILITY_MAX_DAYS days. */
export function availabilityWindow(from: string, days: number): { from: string; to: string; days: number } {
  const n = Math.min(Math.max(1, days), AVAILABILITY_MAX_DAYS);
  return { from, to: addDays(from, n - 1), days: n };
}

/** One empty (quiet) day per date of the window, in date order. */
export function emptyDays(from: string, days: number): Map<string, AvailabilityDay> {
  const byDate = new Map<string, AvailabilityDay>();
  const empty = (): SlotLoad => ({ bookings: 0, guests: 0, level: 'quiet' });
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    byDate.set(date, { date, morning: empty(), afternoon: empty() });
  }
  return byDate;
}

/** Bookings grouped per (visit date, slot). */
export function addBookedLoads(byDate: Map<string, AvailabilityDay>, rows: { date: string | Date; slot: string; bookings: string; guests: string }[]): void {
  for (const r of rows) {
    const day = byDate.get(isoDay(r.date));
    if (!day || !isSlot(r.slot)) continue;
    day[r.slot] = { bookings: Number(r.bookings) || 0, guests: Number(r.guests) || 0, level: 'quiet' };
  }
}

/** Places held mid-form count like bookings until they expire. */
export function addHeldGuests(byDate: Map<string, AvailabilityDay>, rows: { date: string | Date; slot: string; guests: string }[]): void {
  for (const r of rows) {
    const day = byDate.get(isoDay(r.date));
    if (!day || !isSlot(r.slot)) continue;
    day[r.slot].guests += Number(r.guests) || 0;
  }
}

/** Each slot's level from its guests, or "closed" with the closure's reason. */
export function applySlotLevels(byDate: Map<string, AvailabilityDay>, cal: Calendar): void {
  for (const day of byDate.values()) {
    for (const slot of SLOTS) {
      const closure = closureFor(day.date, slot, cal.closures);
      day[slot].level = closure ? 'closed' : busyLevel(day[slot].guests, cal.slotCapacity);
      if (closure) day[slot].closure = { kind: closure.kind, reason: closure.reason };
    }
  }
}

/** Taken places are counted per person, except for flat-priced (per unit) experiences. */
export const takenUnit = (experiences: ReadonlyMap<string, ExperienceInfo>, id: string): 'pp' | 'u' =>
  experiences.get(id)?.priceMode !== 'flat' ? 'pp' : 'u';

/** Per-activity levels, only for experiences that have a capacity. `taken` is keyed "date|slot|id|pp|u". */
export function applyActivityLevels(
  byDate: Map<string, AvailabilityDay>,
  cal: Calendar,
  experiences: ReadonlyMap<string, ExperienceInfo>,
  taken: ReadonlyMap<string, number>,
): void {
  const capped = Object.keys(cal.activityCapacity);
  for (const day of byDate.values()) {
    day.activities = {};
    for (const id of capped) {
      const cap = cal.activityCapacity[id];
      const unit = takenUnit(experiences, id);
      const get = (slot: SlotKey) => taken.get(`${day.date}|${slot}|${id}|${unit}`) ?? 0;
      day.activities[id] = { morning: activityLevel(get('morning'), cap.morning), afternoon: activityLevel(get('afternoon'), cap.afternoon) };
    }
  }
}

/** Timed sessions: one level per start time. `taken` is keyed "date|id|time|pp|u". */
export function applySessionLevels(
  byDate: Map<string, AvailabilityDay>,
  cal: Calendar,
  experiences: ReadonlyMap<string, ExperienceInfo>,
  taken: ReadonlyMap<string, number>,
): void {
  const sessioned = Object.keys(cal.sessions);
  for (const day of byDate.values()) {
    day.sessions = {};
    for (const id of sessioned) {
      const plan = cal.sessions[id];
      const unit = takenUnit(experiences, id);
      const times: Record<string, ActivityLevel> = {};
      for (const t of plan.times) times[t] = activityLevel(taken.get(`${day.date}|${id}|${t}|${unit}`) ?? 0, plan.capacity);
      day.sessions[id] = { durationMin: plan.durationMin, times };
    }
  }
}

/**
 * Adds grouped rows to a "key|pp" / "key|u" tally: guests (pp) and units (u)
 * taken, from bookings and live holds alike.
 */
export function tallyTaken<R extends { pp: number; u: number }>(out: Map<string, number>, rows: R[], keyOf: (row: R) => string): void {
  const add = (k: string, v: number) => out.set(k, (out.get(k) ?? 0) + v);
  for (const r of rows) {
    const key = keyOf(r);
    add(`${key}|pp`, Number(r.pp) || 0);
    add(`${key}|u`, Number(r.u) || 0);
  }
}
