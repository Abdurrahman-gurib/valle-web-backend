import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import type { CookieOptions } from 'express';
import { Repository } from 'typeorm';
import { StaffUser } from '../../entities';
import { normaliseRecoveryCode, openSecret, sha256Hex, verifyTotp } from './totp';
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

/** Password accepted but a second factor is required before a session exists. */
export interface PendingTwoFactor {
  twoFactorRequired: true;
  pendingToken: string;
}

/** How long the client has to type the 6-digit code after the password. */
export const TWO_FACTOR_PENDING_SECONDS = 5 * 60;

const GENERIC_CODE_FAILURE = 'Invalid or expired code';

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

  async login(email: string, password: string): Promise<LoginResult | PendingTwoFactor> {
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

    if (user.totpEnabled && user.totpSecretEnc) {
      const pendingToken = await this.jwt.signAsync(
        { sub: user.id, email: user.email, role: user.role, tv: user.tokenVersion ?? 0, purpose: '2fa' } satisfies StaffJwtPayload,
        { secret: this.secret, expiresIn: TWO_FACTOR_PENDING_SECONDS },
      );
      return { twoFactorRequired: true, pendingToken };
    }

    return this.issueSession(user);
  }

  /** Second half of a two-step login: a TOTP code or one recovery code. */
  async completeTwoFactor(pendingToken: string, code: string): Promise<LoginResult> {
    const payload = await this.verifyToken(pendingToken);
    if (!payload?.sub || payload.purpose !== '2fa') {
      throw new UnauthorizedException('Sign-in expired, enter your password again');
    }
    const user = await this.staffRepo.findOne({ where: { id: payload.sub } });
    if (!user || !user.active || (payload.tv ?? 0) !== (user.tokenVersion ?? 0) || !user.totpEnabled) {
      throw new UnauthorizedException('Sign-in expired, enter your password again');
    }
    if (!(await this.consumeSecondFactor(user, code))) {
      throw new UnauthorizedException(GENERIC_CODE_FAILURE);
    }
    return this.issueSession(user);
  }

  /**
   * Accept a current TOTP code (not replayed) or an unused recovery code,
   * persisting the consumption. Shared with enrolment/disable.
   */
  async consumeSecondFactor(user: StaffUser, code: string): Promise<boolean> {
    const secret = user.totpSecretEnc ? openSecret(user.totpSecretEnc, this.secret) : null;
    if (secret) {
      const step = verifyTotp(secret, code);
      if (step !== null && (user.totpLastStep == null || step > user.totpLastStep)) {
        user.totpLastStep = step;
        await this.staffRepo.update({ id: user.id }, { totpLastStep: step });
        return true;
      }
    }
    const norm = normaliseRecoveryCode(code);
    if (norm.length >= 10) {
      const h = sha256Hex(norm);
      const list = user.recoveryCodeHashes ?? [];
      if (list.includes(h)) {
        user.recoveryCodeHashes = list.filter((x) => x !== h);
        await this.staffRepo.update({ id: user.id }, { recoveryCodeHashes: user.recoveryCodeHashes });
        return true;
      }
    }
    return false;
  }

  /** Key material used to seal TOTP secrets (derived from JWT_SECRET). */
  get sealingSecret(): string {
    return this.secret;
  }

  private async issueSession(user: StaffUser): Promise<LoginResult> {
    await this.staffRepo.update({ id: user.id }, { lastLoginAt: new Date() });
    const staff = this.toPrincipal(user);
    return { token: await this.signToken(staff, user.tokenVersion ?? 0), staff };
  }

  // -------------------------------------------------------------------- jwt

  signToken(staff: StaffPrincipal, tokenVersion = 0): Promise<string> {
    const payload: StaffJwtPayload = {
      sub: staff.id,
      email: staff.email,
      role: staff.role,
      tv: tokenVersion,
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
    if (!payload?.sub || payload.purpose) return null;
    const user = await this.staffRepo.findOne({ where: { id: payload.sub } });
    if (!user || !user.active) return null;
    // Password reset / deactivation bump token_version: older sessions die.
    if ((payload.tv ?? 0) !== (user.tokenVersion ?? 0)) return null;
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
