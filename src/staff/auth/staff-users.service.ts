import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import { StaffUser } from '../../entities';
import { BCRYPT_ROUNDS, StaffSecurityService } from './staff-security.service';
import { STAFF_ROLES, type StaffPrincipal, type StaffRole } from './staff-auth.types';

/** What the Team tab sees: never the hash, the TOTP secret or recovery codes. */
export interface StaffUserView {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  active: boolean;
  twoFactorEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export function toStaffUserView(u: StaffUser): StaffUserView {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    active: u.active,
    twoFactorEnabled: !!u.totpEnabled,
    lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : null,
    createdAt: (u.createdAt ? new Date(u.createdAt) : new Date()).toISOString(),
  };
}

/** Manager-only team administration. */
@Injectable()
export class StaffUsersService {
  constructor(
    @InjectRepository(StaffUser) private readonly repo: Repository<StaffUser>,
    private readonly security: StaffSecurityService,
  ) {}

  async list(): Promise<StaffUserView[]> {
    const rows = await this.repo.find({ order: { active: 'DESC', name: 'ASC' } });
    return rows.map(toStaffUserView);
  }

  /**
   * New account with an unusable random password; the person sets their own
   * through the reset e-mail sent straight away.
   */
  async create(input: { name: string; email: string; role: StaffRole }): Promise<{ user: StaffUserView; emailSent: boolean }> {
    const email = input.email.trim().toLowerCase();
    if (!STAFF_ROLES.includes(input.role)) throw new BadRequestException('Unknown role');
    if (await this.repo.findOne({ where: { email } })) {
      throw new ConflictException('A staff account with this e-mail already exists');
    }
    const placeholder = await bcrypt.hash(randomBytes(32).toString('base64url'), BCRYPT_ROUNDS);
    const user = await this.repo.save(
      this.repo.create({ email, name: input.name.trim(), role: input.role, passwordHash: placeholder, active: true }),
    );
    const emailSent = await this.security.sendResetFor(user, true);
    return { user: toStaffUserView(user), emailSent };
  }

  async update(
    actor: StaffPrincipal,
    id: string,
    patch: { role?: StaffRole; active?: boolean; name?: string },
  ): Promise<StaffUserView> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Staff account not found');

    if (actor.id === user.id) {
      if (patch.active === false) throw new BadRequestException('You cannot deactivate your own account');
      if (patch.role !== undefined && patch.role !== 'manager') {
        throw new BadRequestException('You cannot remove your own manager role');
      }
    }
    if (patch.role !== undefined) {
      if (!STAFF_ROLES.includes(patch.role)) throw new BadRequestException('Unknown role');
      user.role = patch.role;
    }
    if (patch.name !== undefined) user.name = patch.name.trim();
    if (patch.active !== undefined && patch.active !== user.active) {
      user.active = patch.active;
      // Belt and braces with the guard's `active` check: old cookies never come back.
      if (!patch.active) user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    }
    await this.repo.save(user);
    return toStaffUserView(user);
  }

  async sendReset(id: string): Promise<{ emailSent: boolean }> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Staff account not found');
    if (!user.active) throw new BadRequestException('Reactivate the account first');
    return { emailSent: await this.security.sendResetFor(user, true) };
  }
}
