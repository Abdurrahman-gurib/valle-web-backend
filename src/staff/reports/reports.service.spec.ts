import { DataSource } from 'typeorm';
import { toCsv } from './csv';
import { ReportsService } from './reports.service';

/** Answers each SQL statement from a queue, recording the parameters. */
function db(answers: unknown[][]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const query = jest.fn(async (sql: string, params: unknown[]) => { calls.push({ sql, params }); return answers.shift() ?? []; });
  return { ds: { query } as unknown as DataSource, calls };
}

describe('toCsv', () => {
  it('quotes commas and quotes, neutralises formulas, and starts with a BOM', () => {
    const csv = toCsv(['a', 'b'], [['x,y', 'say "hi"'], ['=SUM(1)', 5]]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('"x,y","say ""hi"""');
    expect(csv).toContain("'=SUM(1),5");
  });
});

describe('ReportsService.summary', () => {
  it('fills every day of the range and derives the average ticket', async () => {
    const { ds, calls } = db([
      [{ bookings: '3', guests: '9', adults: '6', kids: '3', revenue: '15000', entry_revenue: '4000', experience_revenue: '11000', discounts: '500', online_revenue: '5000', gate_revenue: '10000' }],
      [{ cancelled: '1' }],
      // the daily series is fetched before the four breakdowns
      [{ date: '2026-10-02', bookings: '2', guests: '6', revenue: '10000' }],
      [{ key: 'confirmed', bookings: '2', guests: '6', revenue: '10000' }, { key: 'cancelled', bookings: '1', guests: '2', revenue: '0' }],
      [{ key: 'gate', bookings: '2', guests: '6', revenue: '10000' }],
      [{ key: 'nr', bookings: '3', guests: '9', revenue: '15000' }],
      [{ key: 'morning', bookings: '3', guests: '9', revenue: '15000' }],
    ]);
    const s = await new ReportsService(ds).summary('2026-10-01', '2026-10-03');
    expect(s.totals).toMatchObject({ bookings: 3, cancelled: 1, guests: 9, revenue: 15000, avgTicket: 5000, onlineRevenue: 5000 });
    expect(s.daily.map((d) => d.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(s.daily[1]).toEqual({ date: '2026-10-02', bookings: 2, guests: 6, revenue: 10000 });
    expect(s.daily[0].revenue).toBe(0);
    expect(s.byStatus.find((b) => b.key === 'cancelled')?.bookings).toBe(1);
    // every statement is bound, never interpolated
    for (const c of calls) expect(c.params).toEqual(['2026-10-01', '2026-10-03']);
  });
});

describe('ReportsService.reconciliation', () => {
  it('splits the day into gate expected / collected / outstanding, online, cancelled and no-shows', async () => {
    const rows = [
      { ref_code: 'A', guest_name: 'A', slot: 'morning', pay_mode: 'gate', status: 'arrived', adults: 2, kids: 0, total: '1000', nationality: '', phone: '', email: '' },
      { ref_code: 'B', guest_name: 'B', slot: 'morning', pay_mode: 'gate', status: 'confirmed', adults: 1, kids: 1, total: '800', nationality: '', phone: '', email: '' },
      { ref_code: 'C', guest_name: 'C', slot: 'afternoon', pay_mode: 'online', status: 'confirmed', adults: 3, kids: 0, total: '3000', nationality: '', phone: '', email: '' },
      { ref_code: 'D', guest_name: 'D', slot: 'afternoon', pay_mode: 'gate', status: 'cancelled', adults: 2, kids: 2, total: '2000', nationality: '', phone: '', email: '' },
    ];
    const { ds } = db([rows]);
    const r = await new ReportsService(ds).reconciliation('2000-01-01'); // in the past: B and C are no-shows
    expect(r.totals).toEqual({
      bookings: 4, guestsExpected: 7, guestsArrived: 2, gateExpected: 1800, gateCollected: 1000, gateOutstanding: 800,
      onlinePaid: 3000, cancelled: 1, cancelledAmount: 2000, noShows: 2, noShowAmount: 3800,
    });
  });
});

describe('ReportsService.forecast', () => {
  it('lists every upcoming day with booked guests per slot and the typical level of that weekday', async () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Indian/Mauritius' });
    const dow = new Date(today + 'T00:00:00Z').getUTCDay();
    const { ds } = db([
      [{ date: today, slot: 'morning', bookings: '2', guests: '10', revenue: '5000' }, { date: today, slot: 'afternoon', bookings: '1', guests: '4', revenue: '2000' }],
      [{ dow: String(dow), days: '8', guests: '80' }],
    ]);
    const f = await new ReportsService(ds).forecast(3);
    expect(f).toHaveLength(3);
    expect(f[0]).toMatchObject({ date: today, bookings: 3, morningGuests: 10, afternoonGuests: 4, guests: 14, revenue: 7000, typicalGuests: 10, pace: 1.4 });
    expect(f[1].guests).toBe(0);
  });
});

describe('ReportsService.exportCsv', () => {
  it('produces a bookings file named after the range', async () => {
    const { ds } = db([[{ ref_code: 'VAL-1-26', visit_date: '2026-10-02', slot: 'morning', status: 'confirmed', guest_name: 'Asha, Jr', nationality: 'MU', email: 'a@x.mu', phone: '', adults: 2, kids: 0, rate: 'rr', pay_mode: 'gate', entry_amount: 1000, subtotal: 1000, discount: 0, total: 1000, currency: 'MUR', staff_note: '', created_at: '2026-09-28T10:00:00.000Z' }]]);
    const { filename, csv } = await new ReportsService(ds).exportCsv('bookings', '2026-10-01', '2026-10-31');
    expect(filename).toBe('bookings_2026-10-01_2026-10-31.csv');
    expect(csv).toContain('Reference,Visit date');
    expect(csv).toContain('VAL-1-26,2026-10-02,morning,confirmed,"Asha, Jr",MU');
  });
});
