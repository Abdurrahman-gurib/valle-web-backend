import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** One anonymous booking-funnel step (no IP, no user agent; sid is a random per-tab id). */
@Entity({ name: 'funnel_events' })
export class FunnelEvent {
  @PrimaryGeneratedColumn({ name: 'id', type: 'bigint' })
  id: string;

  @Column({ name: 'step', type: 'text' })
  step: string;

  @Column({ name: 'label', type: 'text', default: '' })
  label: string;

  @Column({ name: 'sid', type: 'text' })
  sid: string;

  @Column({ name: 'path', type: 'text', default: '' })
  path: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
