import { dbSslOptions } from './db';

describe('dbSslOptions', () => {
  it('verifies the server certificate for DB_SSL=true', () => {
    expect(dbSslOptions('true')).toEqual({ rejectUnauthorized: true });
  });

  it('encrypts without verifying the chain for DB_SSL=no-verify', () => {
    expect(dbSslOptions('no-verify')).toEqual({ rejectUnauthorized: false });
    expect(dbSslOptions('  no-verify ')).toEqual({ rejectUnauthorized: false });
  });

  it('is plain TCP for anything else', () => {
    expect(dbSslOptions('false')).toBe(false);
    expect(dbSslOptions('')).toBe(false);
    expect(dbSslOptions(undefined)).toBe(false);
    expect(dbSslOptions(null)).toBe(false);
  });
});
