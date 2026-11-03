import type { DeepPartial } from 'typeorm';
import type { Booking, BookingLine } from '../entities';
import type { CreateBookingDto } from './dto/create-booking.dto';
import type { AdjustmentKind, PricedBooking, PricedLine } from './pricing';

/**
 * What a booking is written as: its row, its priced lines, and the response
 * the guest gets back. Shared by the public booking flow and the desk's
 * re-pricing, so both persist exactly the same shape.
 */

export interface BookingResponse {
  refCode: string;
  total: number;
  discount: number;
  /** rupees taken off by a coupon / pass, and why */
  adjustment?: number;
  adjustmentNote?: string;
  couponCode?: string;
  lines: { label: string; amount: number }[];
  status: string;
  /** The guest's ticket page (QR inside); also e-mailed / WhatsApped. */
  ticketUrl?: string;
  qrUrl?: string;
  /** "Pay online now" with a provider configured: send the guest here; the ticket follows the payment. */
  checkoutUrl?: string;
  paymentId?: string;
  /** Groups: rupees asked up front. */
  depositAmount?: number;
}

/** A coupon / pass applied to a new booking, with the rupees it takes off. */
export interface BookingAdjustment {
  kind: AdjustmentKind;
  value: number;
  amount: number;
  note: string;
  code: string;
}

export interface Checkout {
  paymentId: string;
  checkoutUrl: string;
}

/** The validated contact and date of a new booking (trimmed, YYYY-MM-DD). */
export interface BookingContact {
  email: string;
  phone: string;
  visitDate: string;
}

/** The `bookings` row of a new website (or desk) booking, before its group deposit. */
export function newBookingRecord(
  dto: CreateBookingDto,
  priced: PricedBooking,
  refCode: string,
  contact: BookingContact,
  adjustment: BookingAdjustment | null,
): DeepPartial<Booking> {
  return {
    refCode,
    visitDate: contact.visitDate,
    slot: dto.slot,
    adults: dto.adults,
    kids: dto.kids,
    rate: dto.rate,
    guestName: dto.name,
    phone: contact.phone,
    email: contact.email,
    nationality: (dto.nationality ?? '').trim(),
    payMode: dto.payMode,
    status: 'confirmed',
    entryAmount: priced.entry,
    subtotal: priced.subtotal,
    discount: priced.discount,
    total: priced.total - (adjustment?.amount ?? 0),
    currency: 'MUR',
    adjustmentKind: adjustment?.kind ?? 'none',
    adjustmentValue: adjustment?.value ?? 0,
    adjustmentAmount: adjustment?.amount ?? 0,
    adjustmentNote: adjustment?.note ?? '',
    couponCode: adjustment?.code ?? '',
    idempotencyKey: dto.idempotencyKey ?? null,
    groupKind: dto.group?.kind ?? null,
    organisation: dto.group?.organisation?.trim() ?? '',
    leaderName: (dto.group?.leaderName ?? (dto.group ? dto.name : '')).trim(),
    participants: (dto.group?.participants ?? []).map((x) => ({ name: x.name.trim(), age: x.age ?? null })),
    depositAmount: 0,
  };
}

/** The `booking_lines` rows for priced lines, in their priced order. */
export function lineRecords(bookingId: string, lines: PricedLine[]): DeepPartial<BookingLine>[] {
  return lines.map((l, i) => ({
    bookingId,
    experienceId: l.experienceId,
    variant: l.variant,
    label: l.label,
    productKey: l.productKey,
    sessionTime: l.time,
    adults: l.adults,
    kids: l.kids,
    units: l.units,
    amount: l.amount,
    sortOrder: i,
  }));
}

/** The create() response for a saved booking. */
export function bookingResponse(
  b: Booking,
  lines: { label: string; amount: number }[],
  links: { ticketUrl?: string; qrUrl?: string },
  checkout: Checkout | null = null,
): BookingResponse {
  return {
    refCode: b.refCode,
    total: b.total,
    discount: b.discount,
    adjustment: b.adjustmentAmount,
    adjustmentNote: b.adjustmentNote,
    couponCode: b.couponCode,
    lines: lines.map((l) => ({ label: l.label, amount: l.amount })),
    status: b.status,
    ticketUrl: links.ticketUrl,
    qrUrl: links.qrUrl,
    ...(checkout ? { checkoutUrl: checkout.checkoutUrl, paymentId: checkout.paymentId } : {}),
    ...(b.depositAmount ? { depositAmount: b.depositAmount } : {}),
  };
}
