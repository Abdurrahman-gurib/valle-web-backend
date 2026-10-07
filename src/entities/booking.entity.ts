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

  /** When the ticket (e-mail / WhatsApp) last went out; null = never delivered. */
  @Column({ name: 'ticket_sent_at', type: 'timestamptz', nullable: true })
  ticketSentAt: Date | null;

  /** When the evening-before reminder went out. */
  @Column({ name: 'reminder_sent_at', type: 'timestamptz', nullable: true })
  reminderSentAt: Date | null;

  // ---- cashier ----
  /** Rupees collected so far (gate payments and online). */
  @Column({ name: 'paid_amount', type: 'int', default: 0 })
  paidAmount: number;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  /** cash | card | juice | online | other */
  @Column({ name: 'payment_method', type: 'text', default: '' })
  paymentMethod: string;

  @Column({ name: 'receipt_no', type: 'text', default: '' })
  receiptNo: string;

  // ---- adjustments: FOC passes, discounts, coupons ----
  /** none | percent | amount | foc | entry_free */
  @Column({ name: 'adjustment_kind', type: 'text', default: 'none' })
  adjustmentKind: string;

  @Column({ name: 'adjustment_value', type: 'int', default: 0 })
  adjustmentValue: number;

  /** Rupees actually taken off the total. */
  @Column({ name: 'adjustment_amount', type: 'int', default: 0 })
  adjustmentAmount: number;

  @Column({ name: 'adjustment_note', type: 'text', default: '' })
  adjustmentNote: string;

  @Column({ name: 'coupon_code', type: 'text', default: '' })
  couponCode: string;

  /** Original visit date when a weather day was postponed. */
  @Column({ name: 'postponed_from', type: 'date', nullable: true })
  postponedFrom: string | null;

  // ---- groups and schools ----
  /** school | company | club | other; null for an ordinary booking */
  @Column({ name: 'group_kind', type: 'text', nullable: true })
  groupKind: 'school' | 'company' | 'club' | 'other' | null;

  @Column({ name: 'organisation', type: 'text', default: '' })
  organisation: string;

  /** The teacher / leader who signs the waiver pack for the party. */
  @Column({ name: 'leader_name', type: 'text', default: '' })
  leaderName: string;

  @Column({ name: 'participants', type: 'jsonb', default: () => "'[]'" })
  participants: { name: string; age?: number | null }[];

  /** Rupees asked up front for a group (group_deposit_percent of the total). */
  @Column({ name: 'deposit_amount', type: 'int', default: 0 })
  depositAmount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
