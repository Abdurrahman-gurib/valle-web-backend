import { ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/**
 * What one arrival slot can take, and when it cannot take anything at all:
 *   - a park-wide number of guests per slot (settings slot_capacity, else the
 *     BOOKING_SLOT_CAPACITY variable, else 150)
 *   - per experience: guests per slot for per-person activities (a zipline's
 *     hourly throughput) or units per slot for vehicles (how many buggies exist)
 *   - closures: whole days or single slots that are closed, under maintenance
 *     or reserved for a private event
 * Everything is edited in the back office (Calendar & capacity) and read here
 * by the public picker, the booking transaction and staff edits alike.
 */

export type SlotKey = 'morning' | 'afternoon';
export type ClosureKind = 'closed' | 'maintenance' | 'private';
export interface Closure { from: string; to: string; slot: 'all' | SlotKey; kind: ClosureKind; reason: string }
/** null = no limit for that slot */
export type ActivityCapacity = Record<string, { morning: number | null; afternoon: number | null }>;
export interface Calendar { slotCapacity: number; closures: Closure[]; activityCapacity: ActivityCapacity }

export const CLOSURE_WORDS: Record<ClosureKind, string> = { closed: 'closed', maintenance: 'closed for maintenance', private: 'reserved for a private event' };
export const SLOT_FULL_MESSAGE = 'That arrival slot is fully booked on this date. Pick the other slot or another day.';
export const DEFAULT_SLOT_CAPACITY = 150;
/** How long a hold keeps places while the guest types. */
export const HOLD_MINUTES = 10;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function parseCalendar(settings: Map<string, string>, envSlotCapacity?: number): Calendar {
  const fromSetting = Number(settings.get('slot_capacity') ?? '');
  const slotCapacity = Number.isFinite(fromSetting) && fromSetting > 0 ? Math.floor(fromSetting)
    : envSlotCapacity && envSlotCapacity > 0 ? envSlotCapacity : DEFAULT_SLOT_CAPACITY;
  return { slotCapacity, closures: parseClosures(settings.get('closures')), activityCapacity: parseActivityCapacity(settings.get('activity_capacity')) };
}

export function parseClosures(raw: string | undefined): Closure[] {
  try {
    const arr = JSON.parse(raw || '[]') as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.flatMap((c) => {
      const o = (c ?? {}) as Partial<Closure>;
      if (typeof o.from !== 'string' || !ISO.test(o.from)) return [];
      const to = typeof o.to === 'string' && ISO.test(o.to) && o.to >= o.from ? o.to : o.from;
      const slot = o.slot === 'morning' || o.slot === 'afternoon' ? o.slot : 'all';
      const kind: ClosureKind = o.kind === 'maintenance' || o.kind === 'private' ? o.kind : 'closed';
      return [{ from: o.from, to, slot, kind, reason: String(o.reason ?? '').slice(0, 120) }];
    });
  } catch {
    return [];
  }
}

export function parseActivityCapacity(raw: string | undefined): ActivityCapacity {
  try {
    const obj = JSON.parse(raw || '{}') as unknown;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    const out: ActivityCapacity = {};
    for (const [id, v] of Object.entries(obj as Record<string, unknown>)) {
      const o = (v ?? {}) as { morning?: unknown; afternoon?: unknown };
      const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : null);
      const m = n(o.morning), a = n(o.afternoon);
      if (m !== null || a !== null) out[id] = { morning: m, afternoon: a };
    }
    return out;
  } catch {
    return {};
  }
}

/** The closure that applies to (date, slot), if any. */
export function closureFor(date: string, slot: SlotKey, closures: Closure[]): Closure | null {
  return closures.find((c) => date >= c.from && date <= c.to && (c.slot === 'all' || c.slot === slot)) ?? null;
}

export function closureMessage(c: Closure, slot: SlotKey): string {
  const when = c.slot === 'all' ? 'on that date' : `for the ${slot} on that date`;
  return `The park is ${CLOSURE_WORDS[c.kind]} ${when}${c.reason ? ` (${c.reason})` : ''}. Pick another day.`;
}

export interface PlacesRequest {
  visitDate: string;
  slot: SlotKey;
  adults: number;
  kids: number;
  items: { id: string; adults?: number; kids?: number; units?: number }[];
  /** The guest's own hold: not counted against them. */
  holdId?: string;
  /** The booking being edited: its own guests do not count. */
  exceptBookingId?: string;
}

export interface ExperienceInfo { name: string; priceMode: 'pp' | 'flat' | 'entry' | 'kiosk' }

const LIVE = `status NOT IN ('cancelled','postponed')`;

/** Guests held for (date, slot) by live holds other than the caller's. */
async function heldGuests(manager: EntityManager, date: string, slot: SlotKey, holdId?: string): Promise<number> {
  const rows = await manager.query(
    `SELECT COALESCE(SUM(adults + kids), 0)::int AS guests FROM slot_holds WHERE visit_date = $1 AND slot = $2 AND expires_at > now() AND ($3::uuid IS NULL OR id <> $3::uuid)`,
    [date, slot, holdId ?? null],
  ) as { guests: number }[];
  return Number(rows[0]?.guests) || 0;
}

/** Guests (per person) or units (flat) one experience already has in (date, slot), bookings plus live holds. */
async function activityTaken(manager: EntityManager, date: string, slot: SlotKey, experienceId: string, perPerson: boolean, holdId?: string, exceptBookingId?: string): Promise<number> {
  const expr = perPerson ? 'l.adults + l.kids' : 'l.units';
  const booked = await manager.query(
    `SELECT COALESCE(SUM(${expr}), 0)::int AS n FROM booking_lines l JOIN bookings b ON b.id = l.booking_id
     WHERE b.visit_date = $1 AND b.slot = $2 AND b.${LIVE} AND l.experience_id = $3 AND ($4::uuid IS NULL OR b.id <> $4::uuid)`,
    [date, slot, experienceId, exceptBookingId ?? null],
  ) as { n: number }[];
  const hexpr = perPerson ? `COALESCE((i->>'adults')::int, 0) + COALESCE((i->>'kids')::int, 0)` : `COALESCE((i->>'units')::int, 0)`;
  const held = await manager.query(
    `SELECT COALESCE(SUM(${hexpr}), 0)::int AS n FROM slot_holds h, jsonb_array_elements(h.items) i
     WHERE h.visit_date = $1 AND h.slot = $2 AND h.expires_at > now() AND i->>'id' = $3 AND ($4::uuid IS NULL OR h.id <> $4::uuid)`,
    [date, slot, experienceId, holdId ?? null],
  ) as { n: number }[];
  return (Number(booked[0]?.n) || 0) + (Number(held[0]?.n) || 0);
}

/**
 * The one check every path goes through, under a transaction-scoped advisory
 * lock on (date, slot) so two parties racing for the last places are
 * serialised. Throws 409 with a sentence the guest can act on.
 */
export async function reservePlaces(manager: EntityManager, req: PlacesRequest, cal: Calendar, experiences: Map<string, ExperienceInfo>): Promise<void> {
  const closure = closureFor(req.visitDate, req.slot, cal.closures);
  if (closure) throw new ConflictException(closureMessage(closure, req.slot));

  await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`slot:${req.visitDate}:${req.slot}`]);

  const booked = await manager.query(
    `SELECT COALESCE(SUM(adults + kids), 0)::int AS guests FROM bookings WHERE visit_date = $1 AND slot = $2 AND ${LIVE} AND ($3::uuid IS NULL OR id <> $3::uuid)`,
    [req.visitDate, req.slot, req.exceptBookingId ?? null],
  ) as { guests: number }[];
  const taken = (Number(booked[0]?.guests) || 0) + (await heldGuests(manager, req.visitDate, req.slot, req.holdId));
  if (taken + req.adults + req.kids > cal.slotCapacity) throw new ConflictException(SLOT_FULL_MESSAGE);

  for (const item of req.items) {
    const cap = cal.activityCapacity[item.id]?.[req.slot];
    if (cap === null || cap === undefined) continue;
    const info = experiences.get(item.id);
    const perPerson = info?.priceMode !== 'flat';
    const wanted = perPerson ? (item.adults ?? 0) + (item.kids ?? 0) : (item.units ?? 1);
    if (wanted <= 0) continue;
    const have = await activityTaken(manager, req.visitDate, req.slot, item.id, perPerson, req.holdId, req.exceptBookingId);
    if (have + wanted > cap) {
      const name = info?.name ?? item.id;
      throw new ConflictException(`${name} is fully booked for the ${req.slot} on this date. Pick the other slot or another day.`);
    }
  }
}

/** Availability levels for the picker, from counts the service has already fetched. */
export function activityLevel(taken: number, cap: number | null): 'quiet' | 'busy' | 'full' {
  if (cap === null) return 'quiet';
  if (taken >= cap) return 'full';
  if (taken >= cap * 0.7) return 'busy';
  return 'quiet';
}
