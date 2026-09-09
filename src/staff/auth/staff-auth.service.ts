import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import type { CookieOptions } from 'express';
import { Repository } from 'typeorm';
import { StaffUser } from '../../entities';
import { parseCookieHeader } from './cookies';
import {
  resolveCookieName,
  resolveJwtSecret,
  STAFF_SESSION_SECONDS,
} from './jwt.config';
import type { StaffJwtPayload, StaffPrincipal } from './staff-auth.types';

/**
 * A real bcrypt hash that matches nothing. Compared against when the email is
 * unknown so a missing account costs the same time as a wrong password: the
 * response is already generic, this keeps the timing generic too.
 */
const DECOY_HASH =
  '$2b$12$vYwWbLJdvXFfzEEk5CEMiezmCPdfa.YoVTWuUxTu1I2lWsGKE1tLW';

/** One message for every failure mode: never reveals whether the email exists. */
const GENERIC_FAILURE = 'Invalid email or password';

export interface LoginResult {
  token: string;
  staff: StaffPrincipal;
}

@Injectable()
export class StaffAuthService {
  /** Name of the httpOnly session cookie (`STAFF_COOKIE_NAME`). */
  readonly cookieName: string;

  private readonly secret: string;
  private readonly isProduction: boolean;

  constructor(
    @InjectRepository(StaffUser)
    private readonly staffRepo: Repository<StaffUser>,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.cookieName = resolveCookieName(config);
    this.secret = resolveJwtSecret(config);
    this.isProduction = config.get<string>('NODE_ENV') === 'production';
  }

  // ------------------------------------------------------------------- login

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.staffRepo.findOne({
      where: { email: email.trim().toLowerCase() },
    });

    // Always run a compare, even with no user, so the two paths take the same
    // time. `active: false` users fall into the same generic failure.
    const hash = user?.active ? user.passwordHash : DECOY_HASH;
    const ok = await bcrypt.compare(password, hash);
    if (!ok || !user || !user.active) {
      throw new UnauthorizedException(GENERIC_FAILURE);
    }

    await this.staffRepo.update({ id: user.id }, { lastLoginAt: new Date() });

    const staff = this.toPrincipal(user);
    return { token: await this.signToken(staff), staff };
  }

  // -------------------------------------------------------------------- jwt

  signToken(staff: StaffPrincipal): Promise<string> {
    const payload: StaffJwtPayload = {
      sub: staff.id,
      email: staff.email,
      role: staff.role,
    };
    return this.jwt.signAsync(payload, {
      secret: this.secret,
      expiresIn: STAFF_SESSION_SECONDS,
    });
  }

  /** Verified payload, or null for a missing / tampered / expired token. */
  async verifyToken(token: string): Promise<StaffJwtPayload | null> {
    try {
      return await this.jwt.verifyAsync<StaffJwtPayload>(token, {
        secret: this.secret,
      });
    } catch {
      return null;
    }
  }

  /**
   * Token → live principal. Re-reads the row so a deactivated or deleted
   * operator loses access immediately instead of at token expiry.
   */
  async staffFromToken(token: string): Promise<StaffPrincipal | null> {
    const payload = await this.verifyToken(token);
    if (!payload?.sub) return null;
    const user = await this.staffRepo.findOne({ where: { id: payload.sub } });
    if (!user || !user.active) return null;
    return this.toPrincipal(user);
  }

  /** Same check, from a raw `Cookie:` header (socket.io handshakes). */
  staffFromCookieHeader(header?: string): Promise<StaffPrincipal | null> {
    const token = parseCookieHeader(header)[this.cookieName];
    if (!token) return Promise.resolve(null);
    return this.staffFromToken(token);
  }

  // ------------------------------------------------------------------ cookie

  cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.isProduction,
      path: '/',
      maxAge: STAFF_SESSION_SECONDS * 1000,
    };
  }

  /** Same attributes minus maxAge, because browsers only clear an exact match. */
  clearCookieOptions(): CookieOptions {
    const { maxAge: _maxAge, ...rest } = this.cookieOptions();
    return rest;
  }

  private toPrincipal(user: StaffUser): StaffPrincipal {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
  }
}
