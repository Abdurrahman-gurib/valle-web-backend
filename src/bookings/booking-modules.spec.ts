import type { Booking } from '../entities';
import {
  addBookedLoads, addHeldGuests, applyActivityLevels, applySessionLevels, applySlotLevels, availabilityWindow, AVAILABILITY_MAX_DAYS, emptyDays, tallyTaken, takenUnit,
} from './availability';
import { bookingResponse, lineRecords, newBookingRecord } from './booking-records';
import type { Calendar, ExperienceInfo } from './capacity';
import type { CreateBookingDto } from './dto/create-booking.dto';
import { entrySettings, explorerPass, groupDepositAmount, type PricedLine, type PricingExperience } from './pricing';

const cal = (over: Partial<Calendar> = {}): Calendar => ({ slotCapacity: 100, closures: [], activityCapacity: {}, sessions: {}, ...over });

describe('availability (pure)', () => {
  it('clamps the window to 1..AVAILABILITY_MAX_DAYS days', () => {
    expect(availabilityWindow('2026-10-01', 0)).toEqual({ from: '2026-10-01', to: '2026-10-01', days: 1 });
    expect(availabilityWindow('2026-10-01', 3)).toEqual({ from: '2026-10-01', to: '2026-10-03', days: 3 });
    expect(availabilityWindow('2026-10-01', 999).days).toBe(AVAILABILITY_MAX_DAYS);
  });

  it('fills booked and held loads, then levels and closures', () => {
    const days = emptyDays('2026-10-01', 2);
    addBookedLoads(days, [
      { date: '2026-10-01', slot: 'morning', bookings: '3', guests: '40' },
      { date: new Date('2026-10-02T00:00:00Z'), slot: 'afternoon', bookings: '1', guests: '2' },
      { date: '2026-10-09', slot: 'morning', bookings: '1', guests: '1' }, // outside the window
      { date: '2026-10-01', slot: 'evening', bookings: '1', guests: '1' }, // not a slot
    ]);
    addHeldGuests(days, [{ date: '2026-10-01', slot: 'morning', guests: '35' }]);
    applySlotLevels(days, cal({ closures: [{ from: '2026-10-02', to: '2026-10-02', slot: 'all', kind: 'maintenance', reason: 'Cables' }] }));
    const [d1, d2] = [...days.values()];
    expect(d1.morning).toEqual({ bookings: 3, guests: 75, level: 'very-busy' });
    expect(d1.afternoon).toEqual({ bookings: 0, guests: 0, level: 'quiet' });
    expect(d2.afternoon).toEqual({ bookings: 1, guests: 2, level: 'closed', closure: { kind: 'maintenance', reason: 'Cables' } });
  });

  it('tallies guests and units per key and reads them per activity and session', () => {
    const taken = new Map<string, number>();
    tallyTaken(taken, [{ k: '2026-10-01|morning|zipline', pp: 8, u: 0 }, { k: '2026-10-01|morning|zipline', pp: 2, u: 0 }, { k: '2026-10-01|afternoon|buggy', pp: 4, u: 2 }], (r) => r.k);
    expect(taken.get('2026-10-01|morning|zipline|pp')).toBe(10);
    expect(taken.get('2026-10-01|afternoon|buggy|u')).toBe(2);

    const experiences = new Map<string, ExperienceInfo>([['zipline', { name: 'Zipline', priceMode: 'pp' }], ['buggy', { name: 'Buggy', priceMode: 'flat' }]]);
    expect(takenUnit(experiences, 'buggy')).toBe('u');
    expect(takenUnit(experiences, 'unknown')).toBe('pp');
    const days = emptyDays('2026-10-01', 1);
    applyActivityLevels(days, cal({ activityCapacity: { zipline: { morning: 10, afternoon: null }, buggy: { morning: 5, afternoon: 2 } } }), experiences, taken);
    expect(days.get('2026-10-01')?.activities).toEqual({
      zipline: { morning: 'full', afternoon: 'quiet' },
      buggy: { morning: 'quiet', afternoon: 'full' },
    });

    const sessions = new Map<string, number>([['2026-10-01|swing|10:00|pp', 6]]);
    applySessionLevels(days, cal({ sessions: { swing: { times: ['10:00', '11:00'], capacity: 6, durationMin: 30 } } }), experiences, sessions);
    expect(days.get('2026-10-01')?.sessions).toEqual({ swing: { durationMin: 30, times: { '10:00': 'full', '11:00': 'quiet' } } });
  });
});

describe('pricing helpers', () => {
  it('reads the entry fallbacks from settings', () => {
    expect(entrySettings(new Map())).toEqual({ entryAdult: 500, entryChild: 250 });
    expect(entrySettings(new Map([['entry_adult', '600'], ['entry_child', '300']]))).toEqual({ entryAdult: 600, entryChild: 300 });
  });

  it('asks a group deposit of the configured share, 30 % when unusable', () => {
    expect(groupDepositAmount(10000, undefined)).toBe(3000);
    expect(groupDepositAmount(10000, '50')).toBe(5000);
    expect(groupDepositAmount(10000, '250')).toBe(10000);
    expect(groupDepositAmount(10000, '-5')).toBe(3000);
    expect(groupDepositAmount(10000, 'abc')).toBe(3000);
    expect(groupDepositAmount(999, '33')).toBe(330);
  });

  it('gives the Explorer Pass for three distinct paid adventure experiences', () => {
    const exp = (id: string, categoryId = 'adventure', priceMode: PricingExperience['priceMode'] = 'pp'): PricingExperience =>
      ({ id, name: id, categoryId, basePrice: 0, priceMode, flatLabel: null, priceRr: null, priceNr: null, sortOrder: 0 });
    const line = (amount: number) => ({ amount } as PricedLine);
    expect(explorerPass([{ exp: exp('a'), line: line(1000) }, { exp: exp('b'), line: line(1000) }])).toEqual({ discount: 0, advCount: 2 });
    expect(explorerPass([{ exp: exp('a'), line: line(1000) }, { exp: exp('a'), line: line(500) }, { exp: exp('b'), line: line(1000) }, { exp: exp('c'), line: line(1000) }]))
      .toEqual({ discount: 525, advCount: 3 });
    // flat, non-adventure and free lines never count
    expect(explorerPass([{ exp: exp('a', 'adventure', 'flat'), line: line(1000) }, { exp: exp('b', 'kids'), line: line(1000) }, { exp: exp('c'), line: line(0) }]).advCount).toBe(0);
  });
});

describe('booking records', () => {
  const priced = {
    lines: [
      { experienceId: null, productKey: null, variant: '', label: 'Park entry · 2 adults', time: null, adults: 2, kids: 0, units: 0, amount: 800 },
      { experienceId: 'zipline', productKey: null, variant: 'The Plunge', label: 'Zipline', time: '10:30', adults: 2, kids: 0, units: 0, amount: 1750 },
    ],
    entry: 800, subtotal: 2550, discount: 0, total: 2550, advCount: 1,
  };

  it('numbers the line rows in priced order', () => {
    expect(lineRecords('b1', priced.lines)).toEqual([
      { bookingId: 'b1', experienceId: null, variant: '', label: 'Park entry · 2 adults', productKey: null, sessionTime: null, adults: 2, kids: 0, units: 0, amount: 800, sortOrder: 0 },
      { bookingId: 'b1', experienceId: 'zipline', variant: 'The Plunge', label: 'Zipline', productKey: null, sessionTime: '10:30', adults: 2, kids: 0, units: 0, amount: 1750, sortOrder: 1 },
    ]);
  });

  it('writes the booking row with the adjustment taken off and the group trimmed', () => {
    const dto = {
      visitDate: '2026-10-02', slot: 'morning', adults: 12, kids: 0, rate: 'rr', name: 'Ms Leader', payMode: 'gate', items: [], nationality: ' MU ',
      group: { kind: 'school', organisation: ' Loreto ', participants: [{ name: ' Ann ', age: 12 }, { name: 'Bob' }] },
    } as unknown as CreateBookingDto;
    const row = newBookingRecord(dto, priced, 'VAL-1234-26', { email: 'a@x', phone: '', visitDate: '2026-10-02' }, { kind: 'amount', value: 500, amount: 500, note: 'Promo', code: 'P1' });
    expect(row).toMatchObject({
      refCode: 'VAL-1234-26', status: 'confirmed', total: 2050, adjustmentKind: 'amount', adjustmentAmount: 500, couponCode: 'P1', nationality: 'MU',
      groupKind: 'school', organisation: 'Loreto', leaderName: 'Ms Leader', participants: [{ name: 'Ann', age: 12 }, { name: 'Bob', age: null }], idempotencyKey: null, depositAmount: 0,
    });
    const plain = newBookingRecord({ ...dto, group: undefined } as CreateBookingDto, priced, 'VAL-1-26', { email: '', phone: '5', visitDate: '2026-10-02' }, null);
    expect(plain).toMatchObject({ total: 2550, adjustmentKind: 'none', adjustmentNote: '', couponCode: '', groupKind: null, organisation: '', leaderName: '', participants: [] });
  });

  it('answers with the checkout and the deposit only when there is one', () => {
    const b = { refCode: 'VAL-1234-26', total: 2550, discount: 0, adjustmentAmount: 0, adjustmentNote: '', couponCode: '', status: 'confirmed', depositAmount: 0 } as Booking;
    expect(bookingResponse(b, priced.lines, { ticketUrl: 't' })).toEqual({
      refCode: 'VAL-1234-26', total: 2550, discount: 0, adjustment: 0, adjustmentNote: '', couponCode: '',
      lines: [{ label: 'Park entry · 2 adults', amount: 800 }, { label: 'Zipline', amount: 1750 }], status: 'confirmed', ticketUrl: 't', qrUrl: undefined,
    });
    const withBoth = bookingResponse({ ...b, depositAmount: 765 } as Booking, [], {}, { paymentId: 'p1', checkoutUrl: 'https://pay' });
    expect(withBoth).toMatchObject({ checkoutUrl: 'https://pay', paymentId: 'p1', depositAmount: 765 });
  });
});
