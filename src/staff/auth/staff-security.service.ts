import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import * as QRCode from 'qrcode';
import { IsNull, Repository } from 'typeorm';
import { StaffPasswordReset, StaffUser } from '../../entities';
import { MailService } from '../../notifications/mail.service';
import { StaffAuthService } from './staff-auth.service';
import {
  generateRecoveryCodes,
  generateTotpSecret,
  normaliseRecoveryCode,
  openSecret,
  otpauthUrl,
  sealSecret,
  sha256Hex,
  verifyTotp,
} from './totp';

export const RESET_TOKEN_MINUTES = 30;
export const MIN_PASSWORD_LENGTH = 10;
/** Same cost the staff:password script uses. */
export const BCRYPT_ROUNDS = 12;

export interface TwoFactorStatus {
  enabled: boolean;
  recoveryCodesLeft: number;
}

export interface TotpSetup {
  otpauthUrl: string;
  qrDataUrl: string;
  secret: string;
}

/**
 * Password resets and two-step-login enrolment. Login itself (including the
 * code step) stays in StaffAuthService.
 */
@Injectable()
export class StaffSecurityService {
  private readonly logger = new Logger(StaffSecurityService.name);
  private readonly siteUrl: string;

  constructor(
    @InjectRepository(StaffUser) private readonly staffRepo: Repository<StaffUser>,
    @InjectRepository(StaffPasswordReset) private readonly resetRepo: Repository<StaffPasswordReset>,
    private readonly auth: StaffAuthService,
    private readonly mail: MailService,
    config: ConfigService,
  ) {
    this.siteUrl = (config.get<string>('SITE_URL') ?? 'https://vallepark.com').trim().replace(/\/+$/, '');
  }

  // ------------------------------------------------------------ password reset

  /**
   * Always resolves (no account enumeration). Unknown or inactive e-mails
   * silently send nothing.
   */
  async requestReset(email: string): Promise<void> {
    const user = await this.staffRepo.findOne({ where: { email: email.trim().toLowerCase() } });
    if (!user || !user.active) return;
    await this.sendResetFor(user, false);
  }

  /** Create a token and mail the link. Returns false when mail is not configured. */
  async sendResetFor(user: StaffUser, byManager: boolean): Promise<boolean> {
    const token = randomBytes(32).toString('base64url');
    await this.resetRepo.save(
      this.resetRepo.create({
        staffId: user.id,
        tokenHash: sha256Hex(token),
        expiresAt: new Date(Date.now() + RESET_TOKEN_MINUTES * 60_000),
        usedAt: null,
      }),
    );
    const link = `${this.siteUrl}/staff/reset?token=${encodeURIComponent(token)}`;
    const intro = byManager
      ? 'A manager has asked for your VALLÉ staff password to be reset.'
      : 'Someone (hopefully you) asked to reset your VALLÉ staff password.';
    const sent = await this.mail.send({
      to: user.email,
      subject: 'Reset your VALLÉ staff password',
      text:
        `Hello ${user.name},\n\n${intro}\n\nChoose a new password here (link valid for ${RESET_TOKEN_MINUTES} minutes, once):\n${link}\n\n` +
        'If you did not ask for this, ignore this e-mail; your password stays the same.\n',
      html:
        `<p>Hello ${escapeHtml(user.name)},</p><p>${escapeHtml(intro)}</p>` +
        `<p><a href="${escapeHtml(link)}">Choose a new password</a> (valid for ${RESET_TOKEN_MINUTES} minutes, once).</p>` +
        '<p>If you did not ask for this, ignore this e-mail; your password stays the same.</p>',
    });
    if (!sent) this.logger.warn(`Password reset for staff ${user.id} could not be e-mailed`);
    return sent;
  }

  /** Consume a token and set the password; signs out every existing session. */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    const invalid = new BadRequestException('This reset link is invalid or has expired');
    const row = await this.resetRepo.findOne({ where: { tokenHash: sha256Hex(token ?? '') } });
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) throw invalid;

    // Claim the token atomically so two concurrent submits cannot both win.
    const claim = await this.resetRepo.update({ id: row.id, usedAt: IsNull() }, { usedAt: new Date() });
    if (!claim.affected) throw invalid;

    const user = await this.staffRepo.findOne({ where: { id: row.staffId } });
    if (!user || !user.active) throw invalid;

    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.staffRepo.update(
      { id: user.id },
      { passwordHash: hash, passwordChangedAt: new Date(), tokenVersion: (user.tokenVersion ?? 0) + 1 },
    );
    // Any other outstanding links for this account die too.
    await this.resetRepo.update({ staffId: user.id, usedAt: IsNull() }, { usedAt: new Date() });
  }

  // ------------------------------------------------------------- two-step login

  async status(staffId: string): Promise<TwoFactorStatus> {
    const user = await this.requireUser(staffId);
    return { enabled: user.totpEnabled, recoveryCodesLeft: (user.recoveryCodeHashes ?? []).length };
  }

  /** Start (or restart) enrolment. The secret is shown only here, before it is enabled. */
  async beginSetup(staffId: string): Promise<TotpSetup> {
    const user = await this.requireUser(staffId);
    if (user.totpEnabled) throw new BadRequestException('Two-step login is already on');
    const secret = generateTotpSecret();
    await this.staffRepo.update({ id: user.id }, { totpPendingEnc: sealSecret(secret, this.auth.sealingSecret) });
    const url = otpauthUrl(secret, user.email);
    return { otpauthUrl: url, qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 240 }), secret };
  }

  /** Confirm enrolment with a code from the app; returns the recovery codes once. */
  async confirmSetup(staffId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    const user = await this.requireUser(staffId);
    if (user.totpEnabled) throw new BadRequestException('Two-step login is already on');
    const secret = user.totpPendingEnc ? openSecret(user.totpPendingEnc, this.auth.sealingSecret) : null;
    if (!secret) throw new BadRequestException('Start the setup again');
    const step = verifyTotp(secret, code);
    if (step === null) throw new BadRequestException('That code does not match, try the newest one');

    const recoveryCodes = generateRecoveryCodes(8);
    await this.staffRepo.update(
      { id: user.id },
      {
        totpSecretEnc: user.totpPendingEnc,
        totpPendingEnc: null,
        totpEnabled: true,
        totpLastStep: step,
        recoveryCodeHashes: recoveryCodes.map((c) => sha256Hex(normaliseRecoveryCode(c))),
      },
    );
    return { recoveryCodes };
  }

  async disable(staffId: string, code: string): Promise<void> {
    const user = await this.requireUser(staffId);
    if (!user.totpEnabled) return;
    if (!(await this.auth.consumeSecondFactor(user, code))) {
      throw new BadRequestException('That code does not match');
    }
    await this.staffRepo.update(
      { id: user.id },
      { totpEnabled: false, totpSecretEnc: null, totpPendingEnc: null, totpLastStep: null, recoveryCodeHashes: [] },
    );
  }

  async regenerateRecoveryCodes(staffId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    const user = await this.requireUser(staffId);
    if (!user.totpEnabled) throw new BadRequestException('Two-step login is off');
    if (!(await this.auth.consumeSecondFactor(user, code))) {
      throw new BadRequestException('That code does not match');
    }
    const recoveryCodes = generateRecoveryCodes(8);
    await this.staffRepo.update(
      { id: user.id },
      { recoveryCodeHashes: recoveryCodes.map((c) => sha256Hex(normaliseRecoveryCode(c))) },
    );
    return { recoveryCodes };
  }

  private async requireUser(staffId: string): Promise<StaffUser> {
    const user = await this.staffRepo.findOne({ where: { id: staffId } });
    if (!user || !user.active) throw new UnauthorizedException('Not signed in');
    return user;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
