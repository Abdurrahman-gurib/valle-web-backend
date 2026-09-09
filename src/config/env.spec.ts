import { loadEnv } from './env';

const PRODUCTION: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  PORT: '3001',
  JWT_SECRET: 'x'.repeat(48),
  CORS_ORIGIN: 'https://vallepark.com',
  DB_HOST: 'postgres.railway.internal',
  DB_PASSWORD: 'secret',
  DB_SSL: 'true',
};

describe('loadEnv', () => {
  it('accepts a complete production environment', () => {
    const env = loadEnv(PRODUCTION);
    expect(env.isProduction).toBe(true);
    expect(env.port).toBe(3001);
    expect(env.trustProxy).toBe(true);
    expect(env.corsOrigins).toEqual(['https://vallepark.com']);
  });

  it('accepts DB_SSL=no-verify in production (self-signed private-network certificate)', () => {
    expect(() => loadEnv({ ...PRODUCTION, DB_SSL: 'no-verify' })).not.toThrow();
  });

  it.each(['false', '', 'yes', undefined])(
    'refuses DB_SSL=%p in production',
    (value) => {
      expect(() => loadEnv({ ...PRODUCTION, DB_SSL: value })).toThrow(/DB_SSL/);
    },
  );

  it('refuses http origins, wildcard origins and a short signing key in production', () => {
    expect(() => loadEnv({ ...PRODUCTION, CORS_ORIGIN: 'http://vallepark.com' })).toThrow(/https/);
    expect(() => loadEnv({ ...PRODUCTION, CORS_ORIGIN: '*' })).toThrow(/CORS_ORIGIN/);
    expect(() => loadEnv({ ...PRODUCTION, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('lists every problem at once', () => {
    expect(() => loadEnv({ NODE_ENV: 'production' })).toThrow(/JWT_SECRET[\s\S]*CORS_ORIGIN[\s\S]*DB_PASSWORD[\s\S]*DB_HOST[\s\S]*DB_SSL/);
  });

  it('keeps development permissive', () => {
    const env = loadEnv({ NODE_ENV: 'development' });
    expect(env.isProduction).toBe(false);
    expect(env.port).toBe(3001);
    expect(env.trustProxy).toBe(false);
    expect(env.corsOrigins).toEqual([]);
  });
});
