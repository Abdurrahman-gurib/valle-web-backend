import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type ReservationStatus = 'requested' | 'confirmed' | 'cancelled';
export interface PreorderLine { item: string; qty: number }

/** A table asked for at one of the park's restaurants, confirmed by the desk. */
@Entity({ name: 'table_reservations' })
export class TableReservation {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id: string;

  @Column({ name: 'restaurant_id', type: 'text' })
  restaurantId: string;

  @Column({ name: 'guest_name', type: 'text' })
  guestName: string;

  @Column({ name: 'email', type: 'text', default: '' })
  email: string;

  @Column({ name: 'phone', type: 'text', default: '' })
  phone: string;

  @Column({ name: 'visit_date', type: 'date' })
  visitDate: string;

  @Column({ name: 'visit_time', type: 'text' })
  visitTime: string;

  @Column({ name: 'party', type: 'int' })
  party: number;

  @Column({ name: 'preorder', type: 'jsonb', default: () => "'[]'" })
  preorder: PreorderLine[];

  @Column({ name: 'notes', type: 'text', default: '' })
  notes: string;

  @Column({ name: 'status', type: 'text', default: 'requested' })
  status: ReservationStatus;

  @Column({ name: 'booking_ref', type: 'text', default: '' })
  bookingRef: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
