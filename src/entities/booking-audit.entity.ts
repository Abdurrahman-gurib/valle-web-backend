import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** What kind of edit an audit row records (mirrors the schema.sql comment). */
export type BookingAuditAction = 'edit' | 'status' | 'note';

/** Audited values are scalars only, so the trail stays readable as JSON. */
export type BookingAuditValue = string | number | null;

export interface BookingAuditChange {
  from: BookingAuditValue;
  to: BookingAuditValue;
}

/** `{ field: { from, to } }` for exactly the fields a PATCH changed. */
export type BookingAuditChanges = Record<string, BookingAuditChange>;

/**
 * Every staff change to a reservation, so an edit can always be traced back.
 * Rows are append only: nothing in the app updates or deletes them.
 */
@Entity({ name: 'booking_audit' })
export class BookingAudit {
  /** bigserial: the pg driver hands back bigint as a string. */
  @PrimaryGeneratedColumn({ name: 'id', type: 'bigint' })
  id: string;

  @Column({ name: 'booking_id', type: 'uuid' })
  bookingId: string;

  /** Null once the operator's account is deleted; staffEmail still identifies them. */
  @Column({ name: 'staff_id', type: 'uuid', nullable: true })
  staffId: string | null;

  @Column({ name: 'staff_email', type: 'text', default: '' })
  staffEmail: string;

  @Column({ name: 'action', type: 'text' })
  action: BookingAuditAction;

  @Column({ name: 'changes', type: 'jsonb', default: () => "'{}'::jsonb" })
  changes: BookingAuditChanges;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
