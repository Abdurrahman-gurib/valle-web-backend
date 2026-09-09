/**
 * Single source of truth for the allowed browser origins, used by the HTTP
 * server (main.ts) and by the socket.io `/chat` namespace, so a cookie that
 * works for one works for the other.
 */

export const DEFAULT_CORS_ORIGIN =
  'http://localhost:5173,http://localhost:4173';

/** Comma-separated `CORS_ORIGIN` → trimmed, non-empty list. */
export function corsOrigins(raw?: string | null): string[] {
  return (raw ?? process.env.CORS_ORIGIN ?? DEFAULT_CORS_ORIGIN)
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

type OriginCallback = (err: Error | null, allow?: boolean) => void;

/**
 * socket.io origin check. Resolved per connection (not at import time) so the
 * gateway honours a `CORS_ORIGIN` that ConfigModule loads from `.env` after the
 * decorator has already been evaluated.
 */
export function socketCorsOrigin(
  origin: string | undefined,
  callback: OriginCallback,
): void {
  // No Origin header = same-origin or a non-browser client (curl, native app).
  if (!origin || corsOrigins().includes(origin)) {
    callback(null, true);
    return;
  }
  callback(null, false);
}
