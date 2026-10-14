import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { StaffRole } from '../staff/auth/staff-auth.types';

/**
 * Back-office operator. Never exposed with its hash.
 *
 * `role` decides which area the account can reach: `agent` for reservations,
 * `hr` for careers, `manager` for both. The column has a matching CHECK
 * constraint in schema.sql, so the union here and the database agree.
 */
@Entity({ name: 'staff_users' })
export class StaffUser {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id: string;

  @Column({ name: 'email', type: 'text', unique: true })
  email: string;

  @Column({ name: 'name', type: 'text' })
  name: string;

  @Column({ name: 'role', type: 'text', default: 'agent' })
  role: StaffRole;

  /** bcrypt hash: never leaves the backend. */
  @Column({ name: 'password_hash', type: 'text' })
  passwordHash: string;

  @Column({ name: 'active', type: 'boolean', default: true })
  active: boolean;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  /** Bumped on password change / deactivation; sessions carrying an older value stop working. */
  @Column({ name: 'token_version', type: 'integer', default: 0 })
  tokenVersion: number;

  @Column({ name: 'password_changed_at', type: 'timestamptz', nullable: true })
  passwordChangedAt: Date | null;

  /** AES-GCM sealed TOTP secret (see totp.ts). Never leaves the backend. */
  @Column({ name: 'totp_secret_enc', type: 'text', nullable: true })
  totpSecretEnc: string | null;

  /** Secret awaiting its first confirming code during enrolment. */
  @Column({ name: 'totp_pending_enc', type: 'text', nullable: true })
  totpPendingEnc: string | null;

  @Column({ name: 'totp_enabled', type: 'boolean', default: false })
  totpEnabled: boolean;

  /** Last accepted 30 s step, so a code cannot be replayed. */
  @Column({ name: 'totp_last_step', type: 'bigint', nullable: true, transformer: { to: (v: number | null) => v, from: (v: string | null) => (v == null ? null : Number(v)) } })
  totpLastStep: number | null;

  /** SHA-256 hex of each unused recovery code. */
  @Column({ name: 'recovery_code_hashes', type: 'jsonb', default: () => "'[]'::jsonb" })
  recoveryCodeHashes: string[];
}
