import type { DeepPartial } from 'typeorm';
import type { BookingAudit, BookingAuditAction, BookingAuditChanges } from '../entities';

/**
 * Who made a change: a staff account, or a system actor with no account
 * (the guest on the ticket page, a payment provider) and only a label.
 */
export interface Actor {
  id: string | null;
  email: string;
}

/** One `booking_audit` row: what changed on a booking, by whom. */
export function auditRecord(bookingId: string, by: Actor, action: BookingAuditAction, changes: BookingAuditChanges): DeepPartial<BookingAudit> {
  return { bookingId, staffId: by.id, staffEmail: by.email, action, changes };
}
