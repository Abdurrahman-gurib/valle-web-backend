import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { toCsv } from './csv';

/**
 * Sales, reconciliation and forecast figures for the back office.
 *
 * Every report is keyed on the VISIT date (when the money is taken at the
 * gate or the guests turn up), cancelled bookings never count as revenue, and
 * "today" is the park's calendar day. Aggregations run in SQL so a season of
 * bookings is one round trip, not a table scan in JavaScript.
 */
const PARK_TZ = 'Indian/Mauritius';
export const parkToday = (): string => new Date().toLocaleDateString('en-CA', { timeZone: PARK_TZ });

const addDays = (iso: string, n: number): string => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dateOf = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const num = (v: unknown): number => Number(v) || 0;

export interface Breakdown { key: string; bookings: number; guests: number; revenue: number }
export interface DailyPoint { date: string; bookings: number; guests: number; revenue: number }

export interface SalesSummary {
  from: string;
  to: string;
  totals: {
    bookings: number;
    cancelled: number;
    guests: number;
    adults: number;
    kids: number;
    revenue: number;
    entryRevenue: number;
    experienceRevenue: number;
    discounts: number;
    avgTicket: number;
    onlineRevenue: number;
    gateRevenue: number;
  };
  byStatus: Breakdown[];
  byPayMode: Breakdown[];
  byRate: Breakdown[];
  bySlot: Breakdown[];
  daily: DailyPoint[];
}

export interface NationalityRow { nationality: string; bookings: number; guests: number; revenue: number; share: number }
export interface ExperienceRow { experienceId: string; label: string; bookings: number; adults: number; kids: number; units: number; revenue: number }

export interface ReconciliationRow {
  refCode: string; guestName: string; slot: string; payMode: string; status: string;
  adults: number; kids: number; total: number; nationality: string; phone: string; email: string;
}
export interface Reconciliation {
  date: string;
  rows: ReconciliationRow[];
  totals: {
    bookings: number;
    guestsExpected: number;
    guestsArrived: number;
    gateExpected: number;   // confirmed + arrived, paying at the gate
    gateCollected: number;  // arrived, paying at the gate
    gateOutstanding: number; // confirmed (not yet arrived), paying at the gate
    onlinePaid: number;     // online, not cancelled
    cancelled: number;
    cancelledAmount: number;
    noShows: number;        // still "confirmed" although the day has passed
    noShowAmount: number;
  };
}

export interface ForecastDay {
  date: string;
  dow: string;
  bookings: number;
  morningGuests: number;
  afternoonGuests: number;
  guests: number;
  revenue: number;
  /** Average guests on this weekday over the previous 8 weeks (all bookings, by visit date). */
  typicalGuests: number;
  /** booked / typical, so a day already above its usual level stands out. */
  pace: number | null;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

@Injectable()
export class ReportsService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async summary(from: string, to: string): Promise<SalesSummary> {
    const live = `visit_date BETWEEN $1 AND $2 AND status <> 'cancelled'`;
    const [tot] = await this.db.query(
      `SELECT COUNT(*)::int AS bookings,
              COALESCE(SUM(adults + kids), 0)::int AS guests,
              COALESCE(SUM(adults), 0)::int AS adults,
              COALESCE(SUM(kids), 0)::int AS kids,
              COALESCE(SUM(total), 0)::bigint AS revenue,
              COALESCE(SUM(entry_amount), 0)::bigint AS entry_revenue,
              COALESCE(SUM(subtotal - entry_amount), 0)::bigint AS experience_revenue,
              COALESCE(SUM(discount), 0)::bigint AS discounts,
              COALESCE(SUM(CASE WHEN pay_mode = 'online' THEN total ELSE 0 END), 0)::bigint AS online_revenue,
              COALESCE(SUM(CASE WHEN pay_mode = 'gate' THEN total ELSE 0 END), 0)::bigint AS gate_revenue
         FROM bookings WHERE ${live}`,
      [from, to],
    );
    const [canc] = await this.db.query(
      `SELECT COUNT(*)::int AS cancelled FROM bookings WHERE visit_date BETWEEN $1 AND $2 AND status = 'cancelled'`,
      [from, to],
    );
    const breakdown = async (col: string, includeCancelled = false): Promise<Breakdown[]> => {
      const rows: { key: string; bookings: string; guests: string; revenue: string }[] = await this.db.query(
        `SELECT ${col} AS key, COUNT(*)::int AS bookings, COALESCE(SUM(adults + kids), 0)::int AS guests,
                COALESCE(SUM(CASE WHEN status <> 'cancelled' THEN total ELSE 0 END), 0)::bigint AS revenue
           FROM bookings WHERE visit_date BETWEEN $1 AND $2 ${includeCancelled ? '' : "AND status <> 'cancelled'"}
          GROUP BY ${col} ORDER BY revenue DESC, bookings DESC`,
        [from, to],
      );
      return rows.map((r) => ({ key: String(r.key ?? ''), bookings: num(r.bookings), guests: num(r.guests), revenue: num(r.revenue) }));
    };
    const dailyRaw: { date: unknown; bookings: string; guests: string; revenue: string }[] = await this.db.query(
      `SELECT visit_date AS date, COUNT(*)::int AS bookings, COALESCE(SUM(adults + kids), 0)::int AS guests,
              COALESCE(SUM(total), 0)::bigint AS revenue
         FROM bookings WHERE ${live} GROUP BY visit_date ORDER BY visit_date`,
      [from, to],
    );
    const byDate = new Map(dailyRaw.map((r) => [dateOf(r.date), r]));
    const daily: DailyPoint[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const r = byDate.get(d);
      daily.push({ date: d, bookings: num(r?.bookings), guests: num(r?.guests), revenue: num(r?.revenue) });
      if (daily.length > 400) break; // a report is a season, not a decade
    }
    const bookings = num(tot.bookings);
    const revenue = num(tot.revenue);
    return {
      from, to,
      totals: {
        bookings, cancelled: num(canc.cancelled), guests: num(tot.guests), adults: num(tot.adults), kids: num(tot.kids),
        revenue, entryRevenue: num(tot.entry_revenue), experienceRevenue: num(tot.experience_revenue), discounts: num(tot.discounts),
        avgTicket: bookings ? Math.round(revenue / bookings) : 0,
        onlineRevenue: num(tot.online_revenue), gateRevenue: num(tot.gate_revenue),
      },
      byStatus: await breakdown('status', true),
      byPayMode: await breakdown('pay_mode'),
      byRate: await breakdown('rate'),
      bySlot: await breakdown('slot'),
      daily,
    };
  }

  async nationalities(from: string, to: string): Promise<NationalityRow[]> {
    const rows: { nationality: string; bookings: string; guests: string; revenue: string }[] = await this.db.query(
      `SELECT COALESCE(NULLIF(TRIM(nationality), ''), 'Not given') AS nationality, COUNT(*)::int AS bookings,
              COALESCE(SUM(adults + kids), 0)::int AS guests, COALESCE(SUM(total), 0)::bigint AS revenue
         FROM bookings WHERE visit_date BETWEEN $1 AND $2 AND status <> 'cancelled'
        GROUP BY 1 ORDER BY guests DESC, revenue DESC`,
      [from, to],
    );
    const totalGuests = rows.reduce((s, r) => s + num(r.guests), 0) || 1;
    return rows.map((r) => ({
      nationality: r.nationality, bookings: num(r.bookings), guests: num(r.guests), revenue: num(r.revenue),
      share: Math.round((num(r.guests) / totalGuests) * 1000) / 10,
    }));
  }

  async experiences(from: string, to: string): Promise<ExperienceRow[]> {
    const rows: { experience_id: string; label: string; bookings: string; adults: string; kids: string; units: string; revenue: string }[] =
      await this.db.query(
        `SELECT l.experience_id, l.label, COUNT(DISTINCT l.booking_id)::int AS bookings,
                COALESCE(SUM(l.adults), 0)::int AS adults, COALESCE(SUM(l.kids), 0)::int AS kids,
                COALESCE(SUM(l.units), 0)::int AS units, COALESCE(SUM(l.amount), 0)::bigint AS revenue
           FROM booking_lines l JOIN bookings b ON b.id = l.booking_id
          WHERE b.visit_date BETWEEN $1 AND $2 AND b.status <> 'cancelled' AND l.experience_id IS NOT NULL
          GROUP BY l.experience_id, l.label ORDER BY revenue DESC, bookings DESC`,
        [from, to],
      );
    return rows.map((r) => ({
      experienceId: r.experience_id, label: r.label, bookings: num(r.bookings), adults: num(r.adults), kids: num(r.kids),
      units: num(r.units), revenue: num(r.revenue),
    }));
  }

  async reconciliation(date: string): Promise<Reconciliation> {
    const raw: {
      ref_code: string; guest_name: string; slot: string; pay_mode: string; status: string; adults: number; kids: number;
      total: string; nationality: string; phone: string; email: string;
    }[] = await this.db.query(
      `SELECT ref_code, guest_name, slot, pay_mode, status, adults, kids, total, nationality, phone, email
         FROM bookings WHERE visit_date = $1
        ORDER BY CASE slot WHEN 'morning' THEN 0 ELSE 1 END, status, guest_name`,
      [date],
    );
    const rows: ReconciliationRow[] = raw.map((r) => ({
      refCode: r.ref_code, guestName: r.guest_name, slot: r.slot, payMode: r.pay_mode, status: r.status,
      adults: num(r.adults), kids: num(r.kids), total: num(r.total), nationality: r.nationality ?? '', phone: r.phone ?? '', email: r.email ?? '',
    }));
    const past = date < parkToday();
    const t = {
      bookings: rows.length, guestsExpected: 0, guestsArrived: 0, gateExpected: 0, gateCollected: 0, gateOutstanding: 0,
      onlinePaid: 0, cancelled: 0, cancelledAmount: 0, noShows: 0, noShowAmount: 0,
    };
    for (const r of rows) {
      const guests = r.adults + r.kids;
      if (r.status === 'cancelled') { t.cancelled++; t.cancelledAmount += r.total; continue; }
      t.guestsExpected += guests;
      if (r.status === 'arrived') t.guestsArrived += guests;
      if (r.payMode === 'online') t.onlinePaid += r.total;
      if (r.payMode === 'gate') {
        t.gateExpected += r.total;
        if (r.status === 'arrived') t.gateCollected += r.total;
        else t.gateOutstanding += r.total;
      }
      if (past && r.status === 'confirmed') { t.noShows++; t.noShowAmount += r.total; }
    }
    return { date, rows, totals: t };
  }

  async forecast(days: number): Promise<ForecastDay[]> {
    const today = parkToday();
    const n = Math.min(Math.max(1, days), 90);
    const to = addDays(today, n - 1);
    const booked: { date: unknown; slot: string; bookings: string; guests: string; revenue: string }[] = await this.db.query(
      `SELECT visit_date AS date, slot, COUNT(*)::int AS bookings, COALESCE(SUM(adults + kids), 0)::int AS guests,
              COALESCE(SUM(total), 0)::bigint AS revenue
         FROM bookings WHERE visit_date BETWEEN $1 AND $2 AND status <> 'cancelled' GROUP BY visit_date, slot`,
      [today, to],
    );
    // Typical day: guests per calendar day of the previous 8 weeks, averaged per weekday.
    const hist: { dow: string; days: string; guests: string }[] = await this.db.query(
      `SELECT EXTRACT(DOW FROM visit_date)::int AS dow, COUNT(DISTINCT visit_date)::int AS days,
              COALESCE(SUM(adults + kids), 0)::int AS guests
         FROM bookings WHERE visit_date BETWEEN $1 AND $2 AND status <> 'cancelled' GROUP BY 1`,
      [addDays(today, -56), addDays(today, -1)],
    );
    const typical = new Map<number, number>();
    for (const h of hist) typical.set(num(h.dow), Math.round(num(h.guests) / 8)); // 8 occurrences of each weekday in 56 days
    const out: ForecastDay[] = [];
    for (let i = 0; i < n; i++) {
      const date = addDays(today, i);
      const dow = new Date(date + 'T00:00:00Z').getUTCDay();
      const rows = booked.filter((b) => dateOf(b.date) === date);
      const m = rows.find((r) => r.slot === 'morning');
      const a = rows.find((r) => r.slot === 'afternoon');
      const guests = num(m?.guests) + num(a?.guests);
      const typ = typical.get(dow) ?? 0;
      out.push({
        date, dow: DOW[dow], bookings: num(m?.bookings) + num(a?.bookings),
        morningGuests: num(m?.guests), afternoonGuests: num(a?.guests), guests,
        revenue: num(m?.revenue) + num(a?.revenue), typicalGuests: typ,
        pace: typ ? Math.round((guests / typ) * 100) / 100 : null,
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- exports

  async exportCsv(type: 'bookings' | 'daily' | 'nationalities' | 'experiences', from: string, to: string): Promise<{ filename: string; csv: string }> {
    const stamp = `${from}_${to}`;
    if (type === 'bookings') {
      const rows: Record<string, unknown>[] = await this.db.query(
        `SELECT ref_code, visit_date, slot, status, guest_name, nationality, email, phone, adults, kids, rate, pay_mode,
                entry_amount, subtotal, discount, total, currency, staff_note, created_at
           FROM bookings WHERE visit_date BETWEEN $1 AND $2 ORDER BY visit_date, slot, guest_name`,
        [from, to],
      );
      return {
        filename: `bookings_${stamp}.csv`,
        csv: toCsv(
          ['Reference', 'Visit date', 'Slot', 'Status', 'Guest', 'Nationality', 'Email', 'Phone', 'Adults', 'Children', 'Rate', 'Payment', 'Park entry', 'Subtotal', 'Discount', 'Total', 'Currency', 'Internal note', 'Booked at'],
          rows.map((r) => [
            r.ref_code as string, dateOf(r.visit_date), r.slot as string, r.status as string, r.guest_name as string, r.nationality as string,
            r.email as string, r.phone as string, num(r.adults), num(r.kids), r.rate === 'nr' ? 'Visitor' : 'Resident',
            r.pay_mode === 'online' ? 'Online' : 'At gate', num(r.entry_amount), num(r.subtotal), num(r.discount), num(r.total),
            r.currency as string, r.staff_note as string, new Date(r.created_at as string).toISOString(),
          ]),
        ),
      };
    }
    if (type === 'daily') {
      const s = await this.summary(from, to);
      return { filename: `daily_sales_${stamp}.csv`, csv: toCsv(['Date', 'Bookings', 'Guests', 'Revenue (Rs)'], s.daily.map((d) => [d.date, d.bookings, d.guests, d.revenue])) };
    }
    if (type === 'nationalities') {
      const rows = await this.nationalities(from, to);
      return { filename: `nationalities_${stamp}.csv`, csv: toCsv(['Nationality', 'Bookings', 'Guests', 'Share of guests (%)', 'Revenue (Rs)'], rows.map((r) => [r.nationality, r.bookings, r.guests, r.share, r.revenue])) };
    }
    const rows = await this.experiences(from, to);
    return { filename: `experiences_${stamp}.csv`, csv: toCsv(['Experience', 'Option', 'Bookings', 'Adults', 'Children', 'Units', 'Revenue (Rs)'], rows.map((r) => [r.experienceId, r.label, r.bookings, r.adults, r.kids, r.units, r.revenue])) };
  }
}
