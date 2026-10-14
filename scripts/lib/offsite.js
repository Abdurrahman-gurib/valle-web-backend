'use strict';
/**
 * Optional off-site copy of each nightly dump to an S3-compatible bucket
 * (Cloudflare R2, Backblaze B2, AWS S3, ...), used by scripts/db-backup.js.
 *
 * No AWS SDK on purpose: the backup image only carries pg and nodemailer, and
 * the three calls needed here (PUT, ListObjectsV2, DELETE) are a few lines of
 * AWS Signature V4 with node:crypto and the built-in fetch. That keeps the
 * image small and leaves nothing extra to patch.
 *
 * Optional AES-256-GCM encryption before upload (OFFSITE_ENCRYPTION_KEY).
 * File format: "VALLEENC" | version 1 (1 byte) | salt (16) | iv (12) | tag (16) | ciphertext.
 * The key is derived from OFFSITE_ENCRYPTION_KEY with scrypt and the per-file salt,
 * so any long passphrase works. Decrypt with: node scripts/db-backup.js --decrypt in.enc out.dump
 *
 * Secrets are never logged: messages name the bucket and object keys only.
 */
const crypto = require('node:crypto');

const MAGIC = Buffer.from('VALLEENC');
const VERSION = 1;
const DEFAULT_KEEP_DAYS = 30;

/** Off-site settings from the environment, or null when the copy is not configured. */
function offsiteConfig(env = process.env) {
  const get = (k) => (env[k] || '').trim();
  const endpoint = get('OFFSITE_S3_ENDPOINT');
  const bucket = get('OFFSITE_S3_BUCKET');
  const accessKeyId = get('OFFSITE_S3_ACCESS_KEY_ID');
  const secretAccessKey = get('OFFSITE_S3_SECRET_ACCESS_KEY');
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  const keep = Number(get('OFFSITE_KEEP_DAYS'));
  return {
    endpoint: endpoint.replace(/\/+$/, ''),
    bucket,
    region: get('OFFSITE_S3_REGION') || 'auto',
    accessKeyId,
    secretAccessKey,
    prefix: (get('OFFSITE_PREFIX') || 'valle-db/').replace(/^\/+/, ''),
    keepDays: Number.isFinite(keep) && keep >= 1 ? Math.floor(keep) : DEFAULT_KEEP_DAYS,
    encryptionKey: get('OFFSITE_ENCRYPTION_KEY') || null,
  };
}

/** Which of the required variables are missing (names only), for a clear status line. */
function missingVars(env = process.env) {
  return ['OFFSITE_S3_ENDPOINT', 'OFFSITE_S3_BUCKET', 'OFFSITE_S3_ACCESS_KEY_ID', 'OFFSITE_S3_SECRET_ACCESS_KEY'].filter((k) => !(env[k] || '').trim());
}

// ---------------------------------------------------------------- encryption

function deriveKey(passphrase, salt) {
  return crypto.scryptSync(String(passphrase), salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

function encrypt(plain, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, Buffer.from([VERSION]), salt, iv, cipher.getAuthTag(), body]);
}

function decrypt(blob, passphrase) {
  if (blob.length < MAGIC.length + 1 + 16 + 12 + 16 || !blob.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('not a VALLÉ encrypted backup');
  if (blob[MAGIC.length] !== VERSION) throw new Error(`unknown encrypted backup version ${blob[MAGIC.length]}`);
  let o = MAGIC.length + 1;
  const salt = blob.subarray(o, (o += 16));
  const iv = blob.subarray(o, (o += 12));
  const tag = blob.subarray(o, (o += 16));
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(blob.subarray(o)), decipher.final()]);
}

// ---------------------------------------------------------------- SigV4

const sha256hex = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
const encodeKey = (k) => k.split('/').map((s) => encodeURIComponent(s)).join('/');
const rfc3986 = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Signs a path-style request (https://endpoint/bucket/key). Returns { url, headers }. */
function sign(cfg, method, key, query = {}, body = Buffer.alloc(0), now = new Date()) {
  const base = new URL(cfg.endpoint);
  const path = `${base.pathname.replace(/\/+$/, '')}/${encodeURIComponent(cfg.bucket)}${key ? `/${encodeKey(key)}` : ''}`;
  const qs = Object.keys(query).sort().map((k) => `${rfc3986(k)}=${rfc3986(String(query[k]))}`).join('&');
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256hex(body);
  const headers = { host: base.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const names = Object.keys(headers).sort();
  const canonical = [method, path, qs, names.map((n) => `${n}:${headers[n]}\n`).join(''), names.join(';'), payloadHash].join('\n');
  const scope = `${day}/${cfg.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonical)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${cfg.secretAccessKey}`, day), cfg.region), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(toSign).digest('hex');
  const out = { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` };
  delete out.host; // fetch sets it
  return { url: `${base.protocol}//${base.host}${path}${qs ? `?${qs}` : ''}`, headers: out };
}

async function request(cfg, method, key, { query, body, fetchImpl = fetch } = {}) {
  const { url, headers } = sign(cfg, method, key, query, body);
  const res = await fetchImpl(url, { method, headers, body: body && body.length ? body : undefined, signal: AbortSignal.timeout(15 * 60_000) });
  const text = await res.text();
  if (!res.ok) {
    const code = /<Code>([^<]+)<\/Code>/.exec(text);
    throw new Error(`${method} ${key || cfg.bucket} answered HTTP ${res.status}${code ? ` ${code[1]}` : ''}`);
  }
  return text;
}

async function listKeys(cfg, opts = {}) {
  const keys = [];
  let token;
  do {
    const query = { 'list-type': '2', prefix: cfg.prefix };
    if (token) query['continuation-token'] = token;
    const xml = await request(cfg, 'GET', '', { ...opts, query });
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1].replace(/&amp;/g, '&'));
    const next = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml);
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) && next ? next[1] : undefined;
  } while (token);
  return keys;
}

/** valle-YYYYMMDD-HHMMSS.dump[.enc][.json] -> its UTC time, or null for anything else. */
function keyTime(key) {
  const m = /valle-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.dump(\.enc)?(\.json)?$/.exec(key);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
}

/** Pure: object keys older than keepDays (by the time in their name). Never anything that is not a dump. */
function expiredKeys(keys, keepDays, now) {
  const limit = now.getTime() - keepDays * 86_400_000;
  return keys.filter((k) => { const t = keyTime(k); return t !== null && t.getTime() < limit; });
}

/**
 * Uploads one dump (+ its manifest) and prunes old copies.
 * Returns { status: 'not_configured' | 'uploaded' | 'failed', detail }. Never throws.
 */
async function copyOffsite({ dumpName, dumpBytes, manifestBytes }, { env = process.env, fetchImpl = fetch, now = new Date(), log = () => undefined } = {}) {
  const cfg = offsiteConfig(env);
  if (!cfg) return { status: 'not_configured', detail: '' };
  try {
    const encrypted = Boolean(cfg.encryptionKey);
    const body = encrypted ? encrypt(dumpBytes, cfg.encryptionKey) : dumpBytes;
    const key = `${cfg.prefix}${dumpName}${encrypted ? '.enc' : ''}`;
    await request(cfg, 'PUT', key, { body, fetchImpl });
    if (manifestBytes) await request(cfg, 'PUT', `${cfg.prefix}${dumpName}.json`, { body: manifestBytes, fetchImpl });
    let detail = `${cfg.bucket}/${key}${encrypted ? ' (AES-256-GCM)' : ' (not encrypted)'}`;
    try {
      const old = expiredKeys(await listKeys(cfg, { fetchImpl }), cfg.keepDays, now);
      for (const k of old) await request(cfg, 'DELETE', k, { fetchImpl });
      if (old.length) detail += `; removed ${old.length} copies older than ${cfg.keepDays} days`;
    } catch (e) {
      detail += `; pruning failed: ${e.message}`;
    }
    log(`off-site copy uploaded: ${detail}`);
    return { status: 'uploaded', detail };
  } catch (e) {
    return { status: 'failed', detail: String(e.message || e).slice(0, 500) };
  }
}

module.exports = { offsiteConfig, missingVars, encrypt, decrypt, sign, keyTime, expiredKeys, copyOffsite, DEFAULT_KEEP_DAYS };
