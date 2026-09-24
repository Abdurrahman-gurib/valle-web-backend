/**
 * Sentry for the API. This file must be the FIRST import of main.ts so the SDK
 * can patch http, express, pg and Nest before any of them load.
 *
 * Off unless SENTRY_DSN is set, so the compose stack and local dev never report.
 */
import * as Sentry from '@sentry/nestjs';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE || process.env.RAILWAY_GIT_COMMIT_SHA || undefined,
    // One request in five as a performance trace; errors are always captured.
    tracesSampleRate: 0.2,
    // Bookings and job applications carry personal data: strip request bodies and cookies.
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies;
        delete event.request.data;
      }
      return event;
    },
  });
}

export const sentryEnabled = Boolean(dsn);
