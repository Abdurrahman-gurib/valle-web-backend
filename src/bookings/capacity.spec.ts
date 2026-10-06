import type { EntityManager } from 'typeorm';
import { activityLevel, closureFor, closureMessage, parseActivityCapacity, parseCalendar, parseClosures, parseSessions, reservePlaces, sessionsForSlot, SLOT_FULL_MESSAGE, type Calendar } from './capacity';

const cal = (over: Partial<Calendar> = {}): Calendar => ({ slotCapacity: 150, closures: [], activityCapacity: {}, sessions: {}, ...over });
const experiences = new Map([
  ['zipline', { name: 'Zipline Adventures', priceMode: 'pp' as const }],
  ['buggy', { name: 'Buggy', priceMode: 'flat' as const }],
]);

/**
 * A manager whose query() answers the capacity SQL from canned numbers:
 * guests already in the slot, and per experience what is booked / held.
 */
function fakeManager(n: { slotBooked?: number; slotHeld?: number; booked?: Record<string, number>; held?: Record<string, number>; session?: Record<string, number> }) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const manager = {
    query: (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      if (sql.includes('pg_advisory_xact_lock')) return Promise.resolve([]);
      if (sql.includes("i->>'time' = $3")) return Promise.resolve([{ n: 0 }]);
      if (sql.includes('l.session_time = $3')) return Promise.resolve([{ n: n.session?.[`${params[1]}|${params[2]}`] ?? 0 }]);
      if (sql.includes('FROM slot_holds h, jsonb_array_elements')) return Promise.resolve([{ n: n.held?.[String(params[2])] ?? 0 }]);
      if (sql.includes('FROM booking_lines l')) return Promise.resolve([{ n: n.booked?.[String(params[2])] ?? 0 }]);
      if (sql.includes('FROM slot_holds')) return Promise.resolve([{ guests: n.slotHeld ?? 0 }]);
      if (sql.includes('FROM bookings')) return Promise.resolve([{ guests: n.slotBooked ?? 0 }]);
      return Promise.resolve([]);
    },
  } as unknown as EntityManager;
  return { manager, calls };
}
const req = (over: Record<string, unknown> = {}) => ({ visitDate: '2026-11-20', slot: 'morning' as const, adults: 2, kids: 1, items: [] as { id: string; adults?: number; kids?: number; units?: number }[], ...over });

describe('calendar settings', () => {
  it('parses closures leniently and ignores junk', () => {
    expect(parseClosures('[{"from":"2026-12-25","kind":"private","reason":"Wedding"},{"from":"bad"},{"from":"2026-12-31","to":"2026-12-30","slot":"afternoon"}]')).toEqual([
      { from: '2026-12-25', to: '2026-12-25', slot: 'all', kind: 'private', reason: 'Wedding' },
      { from: '2026-12-31', to: '2026-12-31', slot: 'afternoon', kind: 'closed', reason: '' },
    ]);
    expect(parseClosures('not json')).toEqual([]);
    expect(parseActivityCapacity('{"zipline":{"morning":60,"afternoon":null},"x":{}}')).toEqual({ zipline: { morning: 60, afternoon: null } });
  });

  it('slot capacity: the setting wins over the variable, which wins over 150', () => {
    expect(parseCalendar(new Map([['slot_capacity', '200']]), 120).slotCapacity).toBe(200);
    expect(parseCalendar(new Map(), 120).slotCapacity).toBe(120);
    expect(parseCalendar(new Map()).slotCapacity).toBe(150);
  });

  it('finds the closure that applies to a date and slot', () => {
    const closures = parseClosures('[{"from":"2026-12-24","to":"2026-12-26","kind":"closed","reason":"Christmas"},{"from":"2026-11-20","slot":"afternoon","kind":"maintenance"}]');
    expect(closureFor('2026-12-25', 'morning', closures)?.reason).toBe('Christmas');
    expect(closureFor('2026-12-27', 'morning', closures)).toBeNull();
    expect(closureFor('2026-11-20', 'morning', closures)).toBeNull();
    expect(closureFor('2026-11-20', 'afternoon', closures)?.kind).toBe('maintenance');
    expect(closureMessage(closures[1], 'afternoon')).toBe('The park is closed for maintenance for the afternoon on that date. Pick another day.');
    expect(activityLevel(59, 60)).toBe('busy');
    expect(activityLevel(60, 60)).toBe('full');
    expect(activityLevel(5, null)).toBe('quiet');
  });
});

describe('reservePlaces', () => {
  it('refuses a closed day before touching the database', async () => {
    const { manager, calls } = fakeManager({});
    const c = cal({ closures: parseClosures('[{"from":"2026-11-20","kind":"private","reason":"Wedding"}]') });
    await expect(reservePlaces(manager, req(), c, experiences)).rejects.toMatchObject({ status: 409, message: /reserved for a private event on that date \(Wedding\)/ });
    expect(calls).toHaveLength(0);
  });

  it('locks the slot and counts bookings plus live holds against the park-wide capacity', async () => {
    const { manager, calls } = fakeManager({ slotBooked: 140, slotHeld: 7 });
    await expect(reservePlaces(manager, req(), cal(), experiences)).resolves.toBeUndefined();
    expect(calls[0]).toEqual({ sql: 'SELECT pg_advisory_xact_lock(hashtext($1))', params: ['slot:2026-11-20:morning'] });
    await expect(reservePlaces(manager, req({ adults: 3 }), cal(), experiences)).rejects.toMatchObject({ status: 409, message: SLOT_FULL_MESSAGE });
  });

  it('the guest\'s own hold and the booking being edited are left out of the count', async () => {
    const { manager, calls } = fakeManager({ slotBooked: 147 });
    await reservePlaces(manager, req({ holdId: 'h1', exceptBookingId: 'b1' }), cal(), experiences);
    const bookingsSql = calls.find((c) => c.sql.includes('FROM bookings') && !c.sql.includes('slot_holds'))!;
    expect(bookingsSql.params).toEqual(['2026-11-20', 'morning', 'b1']);
    const holdsSql = calls.find((c) => c.sql.includes('FROM slot_holds WHERE'))!;
    expect(holdsSql.params).toEqual(['2026-11-20', 'morning', 'h1']);
  });

  it('per-activity: guests for per-person activities, units for vehicles, named in the refusal', async () => {
    const c = cal({ activityCapacity: { zipline: { morning: 60, afternoon: 60 }, buggy: { morning: 6, afternoon: null } } });
    const { manager } = fakeManager({ booked: { zipline: 55, buggy: 4 }, held: { zipline: 2, buggy: 1 } });
    // zipline: 55 + 2 held + 3 wanted = 60 fits exactly; buggy: 4 + 1 + 1 unit = 6 fits
    await expect(reservePlaces(manager, req({ items: [{ id: 'zipline', adults: 2, kids: 1 }, { id: 'buggy', units: 1 }] }), c, experiences)).resolves.toBeUndefined();
    await expect(reservePlaces(manager, req({ items: [{ id: 'zipline', adults: 3, kids: 1 }] }), c, experiences)).rejects.toMatchObject({ status: 409, message: 'Zipline Adventures is fully booked for the morning on this date. Pick the other slot or another day.' });
    await expect(reservePlaces(manager, req({ items: [{ id: 'buggy', units: 2 }] }), c, experiences)).rejects.toMatchObject({ status: 409, message: /Buggy is fully booked/ });
    // no limit for the afternoon buggy, and uncapped activities are never queried
    await expect(reservePlaces(manager, req({ slot: 'afternoon', items: [{ id: 'buggy', units: 9 }, { id: 'quad', adults: 50 }] }), c, experiences)).resolves.toBeUndefined();
  });
});

describe('timed sessions', () => {
  const plan = { zipline: { times: ['09:30', '10:30', '14:00'], capacity: 4, durationMin: 90 } };

  it('parses session plans and limits afternoon arrivals to sessions from 12:00', () => {
    expect(parseSessions('{"zipline":{"times":["14:00","10:30","09:30","9:30","bad","10:30"],"capacity":4,"durationMin":90},"quad":{"times":[]}}')).toEqual(plan);
    expect(sessionsForSlot(plan.zipline, 'morning')).toEqual(['09:30', '10:30', '14:00']);
    expect(sessionsForSlot(plan.zipline, 'afternoon')).toEqual(['14:00']);
    expect(parseCalendar(new Map([['activity_sessions', JSON.stringify(plan)]])).sessions).toEqual(plan);
  });

  it('a session must exist, suit the arrival slot and have room; unscheduled items are untouched', async () => {
    const c = cal({ sessions: plan });
    const { manager } = fakeManager({ session: { 'zipline|09:30': 3 } });
    await expect(reservePlaces(manager, req({ items: [{ id: 'zipline', adults: 1, time: '09:30' }] }), c, experiences)).resolves.toBeUndefined();
    await expect(reservePlaces(manager, req({ items: [{ id: 'zipline', adults: 2, time: '09:30' }] }), c, experiences)).rejects.toMatchObject({ status: 409, message: 'The 09:30 Zipline Adventures session is full on this date. Pick another time.' });
    await expect(reservePlaces(manager, req({ items: [{ id: 'zipline', adults: 1, time: '11:00' }] }), c, experiences)).rejects.toMatchObject({ status: 400, message: /no 11:00 session/ });
    await expect(reservePlaces(manager, req({ slot: 'afternoon', items: [{ id: 'zipline', adults: 1, time: '09:30' }] }), c, experiences)).rejects.toMatchObject({ status: 400, message: /needs a morning arrival/ });
    await expect(reservePlaces(manager, req({ slot: 'afternoon', items: [{ id: 'zipline', adults: 1, time: '14:00' }] }), c, experiences)).resolves.toBeUndefined();
    await expect(reservePlaces(manager, req({ items: [{ id: 'zipline', adults: 9 }] }), c, experiences)).resolves.toBeUndefined();
  });
});
