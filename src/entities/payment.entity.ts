import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded';

/**
 * One attempt to pay a booking online through a payment provider's hosted
 * checkout. Pending until the provider's webhook settles it; the booking's
 * paid_amount follows (see PaymentsService.settle / refund).
 */
@Entity({ name: 'payments' })
export class Payment {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id: string;

  @Column({ name: 'booking_id', type: 'uuid' })
  bookingId: string;

  /** sandbox | peach | mips ... */
  @Column({ name: 'provider', type: 'text' })
  provider: string;

  /** The provider's own id for this checkout / transaction. */
  @Column({ name: 'provider_ref', type: 'text', default: '' })
  providerRef: string;

  @Column({ name: 'amount', type: 'int' })
  amount: number;

  @Column({ name: 'currency', type: 'text', default: 'MUR' })
  currency: string;

  @Column({ name: 'status', type: 'text', default: 'pending' })
  status: PaymentStatus;

  @Column({ name: 'refunded_amount', type: 'int', default: 0 })
  refundedAmount: number;

  @Column({ name: 'failure_reason', type: 'text', default: '' })
  failureReason: string;

  @Column({ name: 'raw', type: 'jsonb', nullable: true })
  raw: unknown | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'settled_at', type: 'timestamptz', nullable: true })
  settledAt: Date | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
