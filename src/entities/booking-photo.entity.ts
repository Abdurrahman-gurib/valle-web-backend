import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A visit photo the desk uploaded for a booking, downloaded from the ticket
 * page. Bytes live in Postgres (bytea) like chat attachments: the containers
 * have no durable disk. Files are capped (see photos.service) so the table
 * and the nightly backup stay manageable.
 */
@Entity({ name: 'booking_photos' })
export class BookingPhoto {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id: string;

  @Column({ name: 'booking_id', type: 'uuid' })
  bookingId: string;

  /** Original file name, sanitised; the download label. */
  @Column({ name: 'name', type: 'text' })
  name: string;

  @Column({ name: 'mime', type: 'text' })
  mime: string;

  @Column({ name: 'size', type: 'int' })
  size: number;

  /** Only loaded by the download route (select: false keeps list queries light). */
  @Column({ name: 'data', type: 'bytea', select: false })
  data: Buffer;

  @Column({ name: 'caption', type: 'text', default: '' })
  caption: string;

  @Column({ name: 'uploaded_by', type: 'text', default: '' })
  uploadedBy: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
