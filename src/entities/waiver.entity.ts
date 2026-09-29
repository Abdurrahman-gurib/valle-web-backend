import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** The statements every participant (or their guardian) ticks before signing. */
export interface WaiverDeclarations {
  risks: boolean;
  health: boolean;
  sober: boolean;
  rules: boolean;
  data: boolean;
}

/**
 * A signed liability waiver: one per participant, filled in on the guest's
 * phone from the ticket link, checked by staff at the gate scan.
 */
@Entity({ name: 'waivers' })
export class Waiver {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id: string;

  @Column({ name: 'booking_id', type: 'uuid' })
  bookingId: string;

  @Column({ name: 'participant_name', type: 'text' })
  participantName: string;

  /** ISO date (YYYY-MM-DD) */
  @Column({ name: 'birth_date', type: 'date' })
  birthDate: string;

  @Column({ name: 'height_cm', type: 'int' })
  heightCm: number;

  @Column({ name: 'weight_kg', type: 'int' })
  weightKg: number;

  @Column({ name: 'is_minor', type: 'boolean' })
  isMinor: boolean;

  @Column({ name: 'guardian_name', type: 'text', default: '' })
  guardianName: string;

  @Column({ name: 'emergency_name', type: 'text' })
  emergencyName: string;

  @Column({ name: 'emergency_phone', type: 'text' })
  emergencyPhone: string;

  @Column({ name: 'medical_notes', type: 'text', default: '' })
  medicalNotes: string;

  @Column({ name: 'declarations', type: 'jsonb' })
  declarations: WaiverDeclarations;

  @Column({ name: 'photo_consent', type: 'boolean', default: false })
  photoConsent: boolean;

  /** data:image/png;base64,... Staff only; never returned to the public API. */
  @Column({ name: 'signature_png', type: 'text' })
  signaturePng: string;

  @Column({ name: 'signed_by', type: 'text' })
  signedBy: string;

  @Column({ name: 'lang', type: 'text', default: 'en' })
  lang: string;

  @Column({ name: 'terms_version', type: 'text' })
  termsVersion: string;

  @Column({ name: 'ip', type: 'text', default: '' })
  ip: string;

  @Column({ name: 'user_agent', type: 'text', default: '' })
  userAgent: string;

  @Column({ name: 'signed_at', type: 'timestamptz', default: () => 'now()' })
  signedAt: Date;
}
