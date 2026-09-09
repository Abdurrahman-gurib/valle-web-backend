import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'bookings' })
export class Booking {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id: string;

  /** VAL-1234-26 */
  @Column({ name: 'ref_code', type: 'text', unique: true })
  refCode: string;

  /** ISO date (YYYY-MM-DD) */
  @Column({ name: 'visit_date', type: 'date' })
  visitDate: string;

  @Column({ name: 'slot', type: 'text' })
  slot: 'morning' | 'afternoon';

  @Column({ name: 'adults', type: 'int' })
  adults: number;

  @Column({ name: 'kids', type: 'int' })
  kids: number;

  @Column({ name: 'rate', type: 'text' })
  rate: 'rr' | 'nr';

  @Column({ name: 'guest_name', type: 'text' })
  guestName: string;

  @Column({ name: 'phone', type: 'text', default: '' })
  phone: string;

  @Column({ name: 'email', type: 'text', default: '' })
  email: string;

  @Column({ name: 'nationality', type: 'text', default: '' })
  nationality: string;

  @Column({ name: 'pay_mode', type: 'text' })
  payMode: 'gate' | 'online';

  @Column({ name: 'status', type: 'text', default: 'confirmed' })
  status: string;

  @Column({ name: 'entry_amount', type: 'int' })
  entryAmount: number;

  /** before discount, incl. entry */
  @Column({ name: 'subtotal', type: 'int' })
  subtotal: number;

  @Column({ name: 'discount', type: 'int', default: 0 })
  discount: number;

  @Column({ name: 'total', type: 'int' })
  total: number;

  @Column({ name: 'currency', type: 'text', default: 'MUR' })
  currency: string;

  /** Back-office only note. Never returned by a public endpoint. */
  @Column({ name: 'staff_note', type: 'text', default: '' })
  staffNote: string;

  /**
   * Touched by staff edits. Plain column, not @UpdateDateColumn: the service
   * sets it in the same transaction as the audit row, so the two always agree.
   * New bookings leave it undefined and take the column default.
   */
  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;

  /** staff_users.id of the last operator to edit, null for untouched bookings. */
  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
