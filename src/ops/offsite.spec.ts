// eslint-disable-next-line @typescript-eslint/no-require-imports
const offsite = require('../../scripts/lib/offsite.js');

const ENV = {
  OFFSITE_S3_ENDPOINT: 'https://acc123.r2.cloudflarestorage.com',
  OFFSITE_S3_BUCKET: 'valle-backups',
  OFFSITE_S3_ACCESS_KEY_ID: 'AKIDEXAMPLE',
  OFFSITE_S3_SECRET_ACCESS_KEY: 'super-secret-value',
  OFFSITE_KEEP_DAYS: '30',
};

describe('off-site backup copy (scripts/lib/offsite.js)', () => {
  it('encrypts and decrypts a dump round-trip with AES-256-GCM', () => {
    const plain = Buffer.from('PGDMP\u0000 some custom-format dump bytes '.repeat(200));
    const blob = offsite.encrypt(plain, 'correct horse battery staple');
    expect(blob.subarray(0, 8).toString()).toBe('VALLEENC');
    expect(blob.includes(Buffer.from('custom-format'))).toBe(false);
    expect(offsite.decrypt(blob, 'correct horse battery staple').equals(plain)).toBe(true);
    // a different salt and IV every time
    expect(offsite.encrypt(plain, 'k').equals(offsite.encrypt(plain, 'k'))).toBe(false);
  });

  it('refuses a wrong key or a tampered file', () => {
    const blob: Buffer = offsite.encrypt(Buffer.from('dump'), 'right');
    expect(() => offsite.decrypt(blob, 'wrong')).toThrow();
    const tampered = Buffer.from(blob);
    tampered[tampered.length - 1] ^= 1;
    expect(() => offsite.decrypt(tampered, 'right')).toThrow();
    expect(() => offsite.decrypt(Buffer.from('not a backup at all, clearly'), 'right')).toThrow(/not a VALL/);
  });

  it('is "not configured" and makes no request when the variables are absent', async () => {
    const fetchImpl = jest.fn();
    const r = await offsite.copyOffsite({ dumpName: 'valle-20261005-220003.dump', dumpBytes: Buffer.from('x') }, { env: {}, fetchImpl });
    expect(r).toEqual({ status: 'not_configured', detail: '' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(offsite.offsiteConfig({ ...ENV, OFFSITE_S3_BUCKET: ' ' })).toBeNull();
    expect(offsite.missingVars({ OFFSITE_S3_ENDPOINT: 'x' })).toEqual(['OFFSITE_S3_BUCKET', 'OFFSITE_S3_ACCESS_KEY_ID', 'OFFSITE_S3_SECRET_ACCESS_KEY']);
  });

  it('uploads, prunes old copies only, and never puts the secret in a URL or the result', async () => {
    const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
    const listing = '<ListBucketResult><IsTruncated>false</IsTruncated>'
      + '<Contents><Key>valle-db/valle-20260801-220000.dump.enc</Key></Contents>'
      + '<Contents><Key>valle-db/valle-20261004-220000.dump.enc</Key></Contents>'
      + '<Contents><Key>valle-db/README.txt</Key></Contents></ListBucketResult>';
    const fetchImpl = jest.fn(async (url: string, init: { method: string; headers: Record<string, string> }) => {
      calls.push({ url, method: init.method, headers: init.headers });
      return { ok: true, status: 200, text: async () => (init.method === 'GET' ? listing : '') };
    });
    const r = await offsite.copyOffsite(
      { dumpName: 'valle-20261005-220003.dump', dumpBytes: Buffer.from('dump'), manifestBytes: Buffer.from('{}') },
      { env: { ...ENV, OFFSITE_ENCRYPTION_KEY: 'k' }, fetchImpl, now: new Date('2026-10-05T22:10:00Z') },
    );
    expect(r.status).toBe('uploaded');
    expect(calls.map((c) => c.method)).toEqual(['PUT', 'PUT', 'GET', 'DELETE']);
    expect(calls[0].url).toBe('https://acc123.r2.cloudflarestorage.com/valle-backups/valle-db/valle-20261005-220003.dump.enc');
    expect(calls[3].url).toMatch(/valle-20260801-220000\.dump\.enc$/);
    expect(calls[0].headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/auto\/s3\/aws4_request/);
    const everything = JSON.stringify({ calls, r });
    expect(everything).not.toContain('super-secret-value');
  });

  it('reports a failed upload without throwing', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 403, text: async () => '<Error><Code>AccessDenied</Code></Error>' }));
    const r = await offsite.copyOffsite({ dumpName: 'valle-20261005-220003.dump', dumpBytes: Buffer.from('x') }, { env: ENV, fetchImpl });
    expect(r.status).toBe('failed');
    expect(r.detail).toMatch(/403 AccessDenied/);
    expect(r.detail).not.toContain('super-secret-value');
  });

  it('signs a request like the AWS SigV4 reference (fixed time)', () => {
    const cfg = offsite.offsiteConfig({ ...ENV, OFFSITE_S3_REGION: 'us-east-1' });
    const a = offsite.sign(cfg, 'GET', '', { prefix: 'valle-db/', 'list-type': '2' }, Buffer.alloc(0), new Date('2026-10-05T00:00:00Z'));
    expect(a.url).toBe('https://acc123.r2.cloudflarestorage.com/valle-backups?list-type=2&prefix=valle-db%2F');
    expect(a.headers['x-amz-date']).toBe('20261005T000000Z');
    expect(a.headers['x-amz-content-sha256']).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    const b = offsite.sign(cfg, 'GET', '', { prefix: 'valle-db/', 'list-type': '2' }, Buffer.alloc(0), new Date('2026-10-05T00:00:00Z'));
    expect(b.headers.authorization).toBe(a.headers.authorization);
  });
});
