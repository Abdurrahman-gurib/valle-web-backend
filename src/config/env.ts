/**
 * Boot-time environment validation.
 *
 * A misconfigured deployment should fail loudly at startup rather than quietly
 * serving traffic with a development signing key or an open CORS policy. Every
 * check below is one that has a real security or correctness consequence in
 * production; development keeps working with sane defaults.
 */

export interface AppEnv {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  corsOrigins: string[];
  /** Behind Railway's edge, Azure Front Door or nginx we sit behind a reverse proxy. */
  trustProxy: boolean;
}

class EnvError extends Error {
  constructor(problems: string[]) {
    super(
      'Refusing to start: the environment is not safe for production.\n' +
        problems.map((p) => `  - ${p}`).join('\n'),
    );
    this.name = 'EnvError';
  }
}

export function loadEnv(env: NodeJS.ProcessEnv = process.env): AppEnv {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';
  const problems: string[] = [];

  const port = Number.parseInt(env.PORT ?? '3001', 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    problems.push(`PORT must be a valid port number, got "${env.PORT ?? ''}"`);
  }

  const origins = (env.CORS_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (isProduction) {
    if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
      problems.push(
        'JWT_SECRET must be set to at least 32 characters. Without it staff sessions ' +
          'would be signed with a key published in this repository.',
      );
    }
    if (origins.length === 0) {
      problems.push('CORS_ORIGIN must list the exact public origins, e.g. https://vallepark.com');
    }
    if (origins.includes('*')) {
      problems.push('CORS_ORIGIN cannot be "*": the staff session cookie travels with credentials.');
    }
    if (origins.some((o) => o.startsWith('http://'))) {
      problems.push('CORS_ORIGIN must use https in production, so the session cookie is never sent in clear text.');
    }
    if (!env.DB_PASSWORD) {
      problems.push('DB_PASSWORD must be set in production.');
    }
    if (!env.DB_HOST) {
      problems.push('DB_HOST must be set in production.');
    }
    const dbSsl = (env.DB_SSL ?? '').trim();
    if (dbSsl !== 'true' && dbSsl !== 'no-verify') {
      problems.push(
        'DB_SSL must be "true" or "no-verify" in production. "true" verifies the server ' +
          'certificate (Azure Database for PostgreSQL, RDS, any public endpoint); "no-verify" ' +
          'still encrypts but accepts a self-signed certificate (Railway Postgres over the ' +
          'private network). Without TLS the database password and all booking and ' +
          'application data would cross the network in clear text.',
      );
    }
  }

  if (problems.length) throw new EnvError(problems);

  return {
    nodeEnv,
    isProduction,
    port,
    corsOrigins: origins,
    // Railway's edge, Azure Front Door and the nginx container all terminate TLS
    // upstream, so Express must trust X-Forwarded-* to see the real client IP
    // (rate limiting) and protocol (secure cookies).
    trustProxy: env.TRUST_PROXY === 'true' || isProduction,
  };
}
