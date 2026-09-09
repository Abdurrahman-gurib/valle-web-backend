import type { TlsOptions } from 'node:tls';

/**
 * `DB_SSL` → the `ssl` option handed to node-postgres through TypeORM.
 *
 *   true       TLS, and verify the server certificate against Node's bundled
 *              roots: Azure Database for PostgreSQL, RDS, any public endpoint.
 *   no-verify  TLS, but accept a self-signed certificate. Railway's Postgres
 *              image ships one, and its private network is only reachable from
 *              inside the project, so the identity check buys nothing there
 *              while the encryption still does.
 *   false      Plain TCP. Local development only; production refuses it
 *              (see env.ts).
 *
 * Deliberately no pinned CA PEM: providers rotate their roots, and a hardcoded
 * certificate turns a rotation into an outage.
 *
 * scripts/lib/db.js mirrors this mapping for the plain-JS operator scripts.
 */
export type DbSslMode = 'true' | 'no-verify' | 'false';

export function dbSslOptions(
  mode: string | undefined | null,
): false | TlsOptions {
  switch ((mode ?? '').trim()) {
    case 'true':
      return { rejectUnauthorized: true };
    case 'no-verify':
      return { rejectUnauthorized: false };
    default:
      return false;
  }
}
