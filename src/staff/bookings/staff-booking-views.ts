import { toIso } from '../../common/park-time';
import type { Booking, BookingAudit, BookingAuditAction, BookingAuditChanges, BookingLine, Quote } from '../../entities';
import { toBookingRow, type BookingRow } from './booking-row';

/** How many audit entries the drawer shows. */
export const AUDIT_LIMIT = 20;

export interface BookingLineRow {
  /** null for the park-entry line */
  experienceId: string | null;
  /** Set instead of experienceId for a package / combo / VIP / photo / cinematic line. */
  productKey: string | null;
  variant: string;
  label: string;
  adults: number;
  kids: number;
  units: number;
  amount: number;
}

/** One entry of the reservation's change history. Back office only. */
export interface BookingAuditRow {
  /** ISO 8601 */
  at: string;
  staffEmail: string;
  action: BookingAuditAction;
  changes: BookingAuditChanges;
}

/**
 * The detail view adds the staff-only fields: the internal note and the audit
 * trail. Never reachable from a public endpoint.
 */
export type BookingDetail = BookingRow & {
  staffNote: string;
  /** ISO 8601, to the millisecond: sent back as `expectedUpdatedAt` so a stale edit gets a 409. */
  updatedAt: string | null;
  /** The guest's ticket page; what the desk forwards by WhatsApp / e-mail. */
  ticketUrl?: string;
  ticketSentAt?: string | null;
  reminderSentAt?: string | null;
  lines: BookingLineRow[];
  /** Most recent first, at most AUDIT_LIMIT entries. */
  audit: BookingAuditRow[];
};

export interface QuoteRow {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  groupSize: string;
  preferredDate: string;
  message: string;
  /** ISO 8601 */
  createdAt: string;
}

export interface StaffStats {
  /** Bookings created today. */
  bookingsToday: number;
  /** Bookings due on site today (visit_date), cancellations excluded. */
  arrivalsToday: number;
  openChats: number;
  /** Open conversations with a visitor message nobody has answered yet. */
  unansweredChats: number;
  /** Guests (adults + children) due on site today, cancellations excluded. */
  guestsToday: number;
  /** SUM(total) of today's visits, cancellations excluded. */
  revenueToday: number;
  /** SUM(total) of bookings created this calendar month, cancellations excluded. */
  revenueMonth: number;
}

export function toBookingDetail(
  booking: Booking,
  lines: BookingLine[],
  audit: BookingAudit[],
): BookingDetail {
  return {
    ...toBookingRow(booking),
    staffNote: booking.staffNote ?? '',
    updatedAt: booking.updatedAt ? toIso(booking.updatedAt) : null,
    ticketSentAt: booking.ticketSentAt ? toIso(booking.ticketSentAt) : null,
    reminderSentAt: booking.reminderSentAt ? toIso(booking.reminderSentAt) : null,
    lines: lines.map((l) => ({
      experienceId: l.experienceId,
      productKey: l.productKey ?? null,
      variant: l.variant || '',
      label: l.label,
      adults: l.adults,
      kids: l.kids,
      units: l.units,
      amount: l.amount,
    })),
    audit: audit.map((a) => ({
      at: toIso(a.createdAt),
      staffEmail: a.staffEmail,
      action: a.action,
      changes: a.changes ?? {},
    })),
  };
}

export function toQuoteRow(q: Quote): QuoteRow {
  return {
    id: q.id,
    name: q.name,
    company: q.company,
    email: q.email,
    phone: q.phone,
    groupSize: q.groupSize,
    preferredDate: q.preferredDate,
    message: q.message,
    createdAt: toIso(q.createdAt),
  };
}
