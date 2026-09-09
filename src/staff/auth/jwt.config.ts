import type { ConfigService } from '@nestjs/config';

/** Session lifetime, per the contract (8 hours). */
export const STAFF_SESSION_SECONDS = 8 * 60 * 60;

export const DEFAULT_STAFF_COOKIE_NAME = 'valle_staff';

/** Only ever used outside production, never a fallback for a live deployment. */
const DEV_JWT_SECRET = 'valle-dev-only-jwt-secret-change-me';

/**
 * Resolve `JWT_SECRET`. Throws at boot in production so a deployment can never
 * silently sign sessions with a public constant.
 */
export function resolveJwtSecret(config: ConfigService): string {
  const secret = config.get<string>('JWT_SECRET')?.trim();
  if (secret) return secret;

  if (config.get<string>('NODE_ENV') === 'production') {
    throw new Error(
      'JWT_SECRET is required when NODE_ENV=production. Refusing to start ' +
        'with a development signing key.',
    );
  }
  // eslint-disable-next-line no-console
  console.warn(
    '[staff-auth] JWT_SECRET is not set, so using the development-only signing ' +
      'key. Set JWT_SECRET before deploying (see .env.example).',
  );
  return DEV_JWT_SECRET;
}

export function resolveCookieName(config: ConfigService): string {
  return (
    config.get<string>('STAFF_COOKIE_NAME')?.trim() ||
    DEFAULT_STAFF_COOKIE_NAME
  );
}
