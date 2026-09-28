import type { Booking } from '../../entities';

/**
 * The booking row as the back office and the staff socket see it. Lives apart
 * from the services so both the public BookingsService (which announces new
 * bookings) and the StaffBookingsService can use it without importing each
 * other, which would be a circular import Nest cannot inject through.
 */
export interface BookingRow {
  id: string;
  refCode: string;
  visitDate: string;
  slot: string;
  adults: number;
  kids: number;
  rate: string;
  guestName: string;
  email: string;
  phone: string;
  nationality: string;
  payMode: string;
  status: string;
  entryAmount: number;
  subtotal: number;
  discount: number;
  total: number;
  currency: string;
  createdAt: string;
}

export function toDateString(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

export function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function toBookingRow(b: Booking): BookingRow {
  return {
    id: b.id,
    refCode: b.refCode,
    visitDate: toDateString(b.visitDate),
    slot: b.slot,
    adults: b.adults,
    kids: b.kids,
    rate: b.rate,
    guestName: b.guestName,
    email: b.email,
    phone: b.phone,
    nationality: b.nationality,
    payMode: b.payMode,
    status: b.status,
    entryAmount: b.entryAmount,
    subtotal: b.subtotal,
    discount: b.discount,
    total: b.total,
    currency: b.currency,
    createdAt: toIso(b.createdAt),
  };
}
