import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** What a guest had on the booking page, kept 14 days behind the link e-mailed to them. */
@Entity({ name: 'booking_drafts' })
export class BookingDraft {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id: string;

  @Column({ name: 'email', type: 'text' })
  email: string;

  @Column({ name: 'payload', type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
