import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'booking_lines' })
export class BookingLine {
  @PrimaryGeneratedColumn({ name: 'id' })
  id: number;

  @Column({ name: 'booking_id', type: 'uuid' })
  bookingId: string;

  /** null for the park-entry line */
  @Column({ name: 'experience_id', type: 'text', nullable: true })
  experienceId: string | null;

  @Column({ name: 'label', type: 'text' })
  label: string;

  @Column({ name: 'adults', type: 'int', default: 0 })
  adults: number;

  @Column({ name: 'kids', type: 'int', default: 0 })
  kids: number;

  @Column({ name: 'units', type: 'int', default: 0 })
  units: number;

  @Column({ name: 'amount', type: 'int' })
  amount: number;

  @Column({ name: 'sort_order', type: 'int' })
  sortOrder: number;
}
