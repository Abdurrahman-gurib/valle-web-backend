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
}
