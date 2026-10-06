import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export interface HeldItem { id: string; adults?: number; kids?: number; units?: number }

/**
 * Places held for a few minutes while a guest fills in their details, so the
 * last spots are not taken by someone else mid-form. Counted like bookings
 * until expires_at; deleted when the booking is written.
 */
@Entity({ name: 'slot_holds' })
export class SlotHold {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id: string;

  @Column({ name: 'visit_date', type: 'date' })
  visitDate: string;

  @Column({ name: 'slot', type: 'text' })
  slot: 'morning' | 'afternoon';

  @Column({ name: 'adults', type: 'int', default: 0 })
  adults: number;

  @Column({ name: 'kids', type: 'int', default: 0 })
  kids: number;

  @Column({ name: 'items', type: 'jsonb', default: () => "'[]'" })
  items: HeldItem[];

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
