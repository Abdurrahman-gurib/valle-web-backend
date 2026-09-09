'use strict';
/**
 * Shared by the operator scripts: connection settings from the same DB_*
 * variables the API reads (src/config/db.ts mirrors the DB_SSL mapping), with
 * DATABASE_URL accepted as a fallback for one-off use against a Railway
 * database from a laptop (`railway run --service Postgres -- node ...`).
 */
const { Client } = require('pg');
const path = require('node:path');

// Local convenience: honour Backend/.env exactly like the API does (@nestjs/config).
// Variables already present in the environment win, so CI and Railway, which set
// real variables and ship no .env file, are unaffected.
try {
  process.loadEnvFile(path.join(__dirname, '..', '..', '.env'));
} catch {
  /* no .env: use the environment as is */
}

/** DB_SSL to node-postgres `ssl` option. Keep in sync with src/config/db.ts. */
function sslOptions(mode) {
  switch ((mode || '').trim()) {
    case 'true':
      return { rejectUnauthorized: true };
    case 'no-verify':
      return { rejectUnauthorized: false };
    default:
      return false;
  }
}

function clientConfig(env = process.env) {
  const ssl = sslOptions(env.DB_SSL);
  if (!env.DB_HOST && env.DATABASE_URL) {
    // A DATABASE_URL is normally a remote endpoint (Railway TCP proxy, a hosted
    // database), so default to TLS unless DB_SSL says otherwise. Self-signed
    // certificates are accepted here because that is what Railway serves.
    const urlSsl = env.DB_SSL === undefined ? { rejectUnauthorized: false } : ssl;
    return { connectionString: env.DATABASE_URL, ssl: urlSsl };
  }
  return {
    host: env.DB_HOST || 'localhost',
    port: Number.parseInt(env.DB_PORT || '5433', 10),
    user: env.DB_USER || 'postgres',
    password: env.DB_PASSWORD || 'postgres',
    database: env.DB_NAME || 'valle_park',
    ssl,
  };
}

/** Human-readable target, never including the password. */
function describe(cfg) {
  if (cfg.connectionString) {
    try {
      const u = new URL(cfg.connectionString);
      return `${u.username}@${u.hostname}:${u.port || 5432}${u.pathname}`;
    } catch {
      return 'DATABASE_URL';
    }
  }
  return `${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`;
}

/**
 * Connects, retrying while the database is still coming up: on the very first
 * deploy the Postgres service can be a few seconds behind the API's pre-deploy
 * step, and Railway's private DNS itself needs a moment after container start.
 */
async function connect({ attempts = 30, delayMs = 2000, log = console.log } = {}) {
  const cfg = clientConfig();
  let lastErr;
  for (let i = 1; i <= attempts; i += 1) {
    const client = new Client(cfg);
    try {
      await client.connect();
      return client;
    } catch (err) {
      lastErr = err;
      await client.end().catch(() => {});
      log(`[db] attempt ${i}/${attempts} to reach ${describe(cfg)} failed: ${err.message}`);
      if (i < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
}

module.exports = { clientConfig, connect, describe, sslOptions };
