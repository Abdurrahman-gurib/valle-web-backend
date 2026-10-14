import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * RFC 6238 TOTP (SHA-1, 6 digits, 30 s), the profile every authenticator app
 * (Google Authenticator, Microsoft Authenticator, 1Password, Authy) accepts.
 * Implemented on node:crypto so there is no extra dependency to keep patched.
 */
export const TOTP_PERIOD = 30;
export const TOTP_DIGITS = 6;

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160-bit random secret, base32 (RFC 4226 recommends ≥ 128 bits). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secretB32: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', base32Decode(secretB32)).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];
  return String(bin % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

export function totpStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD);
}

export function totpAt(secretB32: string, nowMs = Date.now()): string {
  return hotp(secretB32, totpStep(nowMs));
}

/**
 * The step a code matches within ±`window` steps (clock drift), or null.
 * Callers reject a step ≤ the last one accepted, so a code is single-use.
 */
export function verifyTotp(
  secretB32: string,
  code: string,
  nowMs = Date.now(),
  window = 1,
): number | null {
  const clean = (code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const now = totpStep(nowMs);
  for (let d = -window; d <= window; d++) {
    const step = now + d;
    if (step < 0) continue;
    const expected = Buffer.from(hotp(secretB32, step));
    if (timingSafeEqual(expected, Buffer.from(clean))) return step;
  }
  return null;
}

export function otpauthUrl(secretB32: string, account: string, issuer = 'VALLÉ Staff'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretB32,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ------------------------------------------------------------ secret sealing

function keyFrom(masterSecret: string): Buffer {
  return createHash('sha256').update(`valle-totp-v1:${masterSecret}`).digest();
}

/** AES-256-GCM, `v1.iv.tag.ciphertext` in base64url. */
export function sealSecret(plain: string, masterSecret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(masterSecret), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

export function openSecret(sealed: string, masterSecret: string): string | null {
  try {
    const [v, iv, tag, ct] = sealed.split('.');
    if (v !== 'v1') return null;
    const d = createDecipheriv('aes-256-gcm', keyFrom(masterSecret), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ recovery codes

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Normalise user input: case and dashes/spaces do not matter. */
export function normaliseRecoveryCode(code: string): string {
  return (code ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Eight `xxxxx-xxxxx` codes (50 bits each). */
export function generateRecoveryCodes(count = 8): string[] {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(10);
    const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}
