import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import type { Repository } from 'typeorm';
import type { StaffPasswordReset, StaffUser } from '../../entities';
import type { MailService } from '../../notifications/mail.service';
import { StaffAuthService } from './staff-auth.service';
import { StaffSecurityService } from './staff-security.service';
import { StaffUsersService } from './staff-users.service';
import { base32Encode, hotp, openSecret, sealSecret, totpAt, totpStep, verifyTotp } from './totp';

/** Minimal in-memory repository supporting the calls these services make. */
function memRepo<T extends { id: string }>(rows: T[]) {
  const matches = (row: T, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      const val = (row as Record<string, unknown>)[k];
      if (v && typeof v === 'object' && (v as { _type?: string })._type === 'isNull') return val == null;
      return val === v;
    });
  return {
    rows,
    findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) => rows.find((r) => matches(r, where)) ?? null),
    find: jest.fn(async () => [...rows]),
    update: jest.fn(async (where: Record<string, unknown>, patch: Partial<T>) => {
      let affected = 0;
      for (const r of rows) if (matches(r, where)) { Object.assign(r, patch); affected++; }
      return { affected };
    }),
    create: jest.fn((v: Partial<T>) => ({ ...v }) as T),
    save: jest.fn(async (v: T) => {
      if (!v.id) v.id = `id-${rows.length + 1}`;
      const i = rows.findIndex((r) => r.id === v.id);
      if (i >= 0) rows[i] = v; else rows.push(v);
      return v;
    }),
  };
}

const config = (vars: Record<string, string>) => ({ get: (k: string) => vars[k] }) as unknown as ConfigService;

function user(over: Partial<StaffUser> = {}): StaffUser {
  return {
    id: 'u1', email: 'ana@valle.test', name: 'Ana', role: 'manager', passwordHash: bcrypt.hashSync('old-password-1', 4),
    active: true, lastLoginAt: null, createdAt: new Date(), tokenVersion: 0, passwordChangedAt: null,
    totpSecretEnc: null, totpPendingEnc: null, totpEnabled: false, totpLastStep: null, recoveryCodeHashes: [],
    ...over,
  } as StaffUser;
}

function setup(users: StaffUser[]) {
  const staffRepo = memRepo(users);
  const resetRepo = memRepo<StaffPasswordReset>([]);
  const sent: { to: string; text?: string }[] = [];
  const mail = { send: jest.fn(async (m: { to: string; text?: string }) => { sent.push(m); return true; }) } as unknown as MailService;
  const cfg = config({ JWT_SECRET: 'j'.repeat(40), SITE_URL: 'https://site.test/' });
  const auth = new StaffAuthService(staffRepo as unknown as Repository<StaffUser>, new JwtService({}), cfg);
  const security = new StaffSecurityService(
    staffRepo as unknown as Repository<StaffUser>, resetRepo as unknown as Repository<StaffPasswordReset>, auth, mail, cfg,
  );
  const users$ = new StaffUsersService(staffRepo as unknown as Repository<StaffUser>, security);
  return { staffRepo, resetRepo, sent, auth, security, users: users$ };
}

const tokenFrom = (text?: string) => decodeURIComponent(/token=([^\s]+)/.exec(text ?? '')![1]);

describe('TOTP (RFC 6238)', () => {
  // RFC 6238 Appendix B, SHA-1 secret "12345678901234567890", 8 digits → we use the last 6.
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it.each([
    [59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'],
  ])('matches the RFC vector at t=%i', (t, code) => {
    expect(hotp(secret, Math.floor(t / 30))).toBe(code);
  });

  it('accepts ±1 step of drift and rejects older codes and junk', () => {
    const now = 1_700_000_000_000;
    expect(verifyTotp(secret, totpAt(secret, now), now)).toBe(totpStep(now));
    expect(verifyTotp(secret, totpAt(secret, now - 30_000), now)).toBe(totpStep(now) - 1);
    expect(verifyTotp(secret, totpAt(secret, now - 90_000), now)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', now)).toBeNull();
  });

  it('seals secrets so only the same key opens them', () => {
    const sealed = sealSecret('JBSWY3DPEHPK3PXP', 'k1');
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(openSecret(sealed, 'k1')).toBe('JBSWY3DPEHPK3PXP');
    expect(openSecret(sealed, 'k2')).toBeNull();
  });
});

describe('password reset lifecycle', () => {
  it('stays silent for unknown e-mails and stores only a hash', async () => {
    const t = setup([user()]);
    await t.security.requestReset('nobody@valle.test');
    expect(t.sent).toHaveLength(0);
    await t.security.requestReset('ANA@valle.test');
    expect(t.sent).toHaveLength(1);
    const token = tokenFrom(t.sent[0].text);
    expect(t.sent[0].text).toContain('https://site.test/staff/reset?token=');
    expect(t.resetRepo.rows[0].tokenHash).not.toBe(token);
    expect(t.resetRepo.rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sets the password once, bumps the token version and kills old sessions', async () => {
    const t = setup([user()]);
    const old = await t.auth.login('ana@valle.test', 'old-password-1');
    if (!('token' in old)) throw new Error('expected a session');
    expect(await t.auth.staffFromToken(old.token)).not.toBeNull();

    await t.security.requestReset('ana@valle.test');
    const token = tokenFrom(t.sent[0].text);
    await expect(t.security.resetPassword(token, 'short')).rejects.toBeInstanceOf(BadRequestException);
    await t.security.resetPassword(token, 'brand-new-password');
    expect(t.staffRepo.rows[0].tokenVersion).toBe(1);
    expect(await t.auth.staffFromToken(old.token)).toBeNull();
    await expect(t.auth.login('ana@valle.test', 'brand-new-password')).resolves.toHaveProperty('token');

    // single use
    await expect(t.security.resetPassword(token, 'another-password-2')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an expired token', async () => {
    const t = setup([user()]);
    await t.security.requestReset('ana@valle.test');
    t.resetRepo.rows[0].expiresAt = new Date(Date.now() - 1000);
    await expect(t.security.resetPassword(tokenFrom(t.sent[0].text), 'brand-new-password')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('two-step login', () => {
  it('enrols, then requires a code before a session, accepts recovery codes once', async () => {
    const t = setup([user()]);
    const s = await t.security.beginSetup('u1');
    expect(s.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    await expect(t.security.confirmSetup('u1', '000000')).rejects.toBeInstanceOf(BadRequestException);
    const { recoveryCodes } = await t.security.confirmSetup('u1', totpAt(s.secret));
    expect(recoveryCodes).toHaveLength(8);
    expect(t.staffRepo.rows[0].totpSecretEnc).not.toContain(s.secret);

    const step1 = await t.auth.login('ana@valle.test', 'old-password-1');
    expect(step1).toHaveProperty('twoFactorRequired', true);
    const pending = (step1 as { pendingToken: string }).pendingToken;
    // The pending token is not a session.
    expect(await t.auth.staffFromToken(pending)).toBeNull();
    // Code used for enrolment cannot be replayed.
    await expect(t.auth.completeTwoFactor(pending, totpAt(s.secret))).rejects.toBeInstanceOf(UnauthorizedException);

    const done = await t.auth.completeTwoFactor(pending, recoveryCodes[0].toUpperCase());
    expect(done.staff.id).toBe('u1');
    await expect(t.auth.completeTwoFactor(pending, recoveryCodes[0])).rejects.toBeInstanceOf(UnauthorizedException);
    expect(t.staffRepo.rows[0].recoveryCodeHashes).toHaveLength(7);
  });
});

describe('team admin rules', () => {
  const me = { id: 'u1', email: 'ana@valle.test', name: 'Ana', role: 'manager' as const };

  it('refuses self-deactivation and self-demotion', async () => {
    const t = setup([user()]);
    await expect(t.users.update(me, 'u1', { active: false })).rejects.toBeInstanceOf(BadRequestException);
    await expect(t.users.update(me, 'u1', { role: 'agent' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deactivated users cannot log in and lose their sessions', async () => {
    const t = setup([user(), user({ id: 'u2', email: 'bo@valle.test', name: 'Bo', role: 'agent' })]);
    const s = await t.auth.login('bo@valle.test', 'old-password-1');
    if (!('token' in s)) throw new Error('expected a session');
    await t.users.update(me, 'u2', { active: false });
    expect(await t.auth.staffFromToken(s.token)).toBeNull();
    await expect(t.auth.login('bo@valle.test', 'old-password-1')).rejects.toBeInstanceOf(UnauthorizedException);
    // Reactivation does not resurrect the old cookie.
    await t.users.update(me, 'u2', { active: true });
    expect(await t.auth.staffFromToken(s.token)).toBeNull();
  });

  it('never exposes secrets in the list and e-mails new users a link', async () => {
    const t = setup([user()]);
    const created = await t.users.create({ name: 'Cy', email: 'CY@valle.test', role: 'agent' });
    expect(created.emailSent).toBe(true);
    const list = await t.users.list();
    for (const row of list) {
      expect(row).not.toHaveProperty('passwordHash');
      expect(row).not.toHaveProperty('totpSecretEnc');
      expect(row).not.toHaveProperty('recoveryCodeHashes');
    }
    expect(list.find((r) => r.email === 'cy@valle.test')).toBeTruthy();
  });
});
