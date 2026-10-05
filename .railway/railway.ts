import { defineRailway, github, postgres, preserve, project, service, volume } from "railway/iac";

/**
 * Railway project definition for VALLE Advenature Park: project "valle-web".
 *
 * Source of truth for the topology described in DEPLOYMENT.md: the api (this
 * repository) and web (valle-web-frontend) services with their GitHub sources,
 * healthchecks, the api pre-deploy database bootstrap, every non-secret
 * variable, and the Postgres database with its volume. Secret values
 * (JWT_SECRET, the database password) are never written here: preserve()
 * keeps whatever is set on Railway.
 *
 *   npm install                 # the "railway" dev dependency provides railway/iac
 *   railway link                # once per clone: valle-web / production
 *   railway config plan         # diff this file against the live project (read-only)
 *   railway config apply        # apply after reviewing the plan
 *
 * Both services deploy automatically from GitHub on every push to main; this
 * file only needs applying when the topology or a non-secret variable changes.
 */
export default defineRailway(() => {
  const Postgres = postgres("Postgres", { region: "ams" });
  const postgresVolume = volume("postgres-volume", {
    alerts: { usage: { "100": {}, "80": {}, "95": {} } },
    allowOnlineResize: true,
    region: "ams",
    sizeMB: 50000,
  });

  // Public entry point: nginx serving the SPA and proxying /api and /socket.io
  // to the api service over the private network (see nginx.conf.template in
  // valle-web-frontend).
  const web = service("web", {
    source: github("Abdurrahman-gurib/valle-web-frontend", { branch: "main" }),
    healthcheck: "/",
    healthcheckTimeout: 120,
    replicas: { ams: 1 },
    env: {
      PORT: "80",
      API_UPSTREAM: "api.railway.internal:3001",
      TRUST_EDGE_HEADERS: "1",
      // Canonical origin baked into the prerendered pages (build arg) and
      // enforced by nginx at runtime (see "Search engines" in DEPLOYMENT.md).
      VITE_SITE_URL: "https://web-production-ff60b.up.railway.app",
      CANONICAL_HOST: "web-production-ff60b.up.railway.app",
      // Set on Railway, kept as they are (browser error monitoring and source maps).
      // Listing them matters: a variable missing from this file is DELETED by `railway config apply`.
      VITE_SENTRY_DSN: preserve(),
      VITE_SENTRY_ENVIRONMENT: preserve(),
      VITE_SENTRY_RELEASE: preserve(),
      SENTRY_AUTH_TOKEN: preserve(),
    },
  });

  // Private API. Exactly one replica: the chat gateway keeps socket state in
  // memory (see "Scaling notes" in DEPLOYMENT.md).
  const api = service("api", {
    source: github("Abdurrahman-gurib/valle-web-backend", { branch: "main" }),
    healthcheck: "/api/health",
    healthcheckTimeout: 300,
    replicas: { ams: 1 },
    deploy: { preDeployCommand: ["node scripts/db-init.js"], preDeployTimeoutSeconds: 300 },
    env: {
      NODE_ENV: "production",
      PORT: "3001",
      // Origin named in /api/sitemap.xml, robots.txt and the guest ticket links.
      SITE_URL: "https://web-production-ff60b.up.railway.app",
      // Guest tickets, reminders and the desk alert go out through Resend
      // (SMTP_URL holds the API key and is set as a secret, not here).
      MAIL_FROM: "VALLÉ Advenature Park <bookings@vallepark.com>",
      BOOKING_NOTIFY_TO: "sales@vallepark.com",
      DB_HOST: Postgres.env.RAILWAY_PRIVATE_DOMAIN,
      DB_PORT: "5432",
      DB_USER: Postgres.env.PGUSER,
      DB_PASSWORD: Postgres.env.PGPASSWORD,
      DB_NAME: Postgres.env.PGDATABASE,
      DB_SSL: "no-verify",
      JWT_SECRET: preserve(),
      // Secrets and deploy-time values set on Railway, never written here. They must stay
      // listed: a variable missing from this file is DELETED by `railway config apply`.
      SMTP_URL: preserve(),          // Resend (guest tickets, reminders, backup alerts)
      D360_API_KEY: preserve(),      // WhatsApp Business (360dialog)
      SENTRY_DSN: preserve(),
      SENTRY_ENVIRONMENT: preserve(),
      SENTRY_RELEASE: preserve(),    // stamped by CI on every deploy
      SENTRY_AUTH_TOKEN: preserve(),
      STAFF_COOKIE_NAME: "valle_staff",
      CORS_ORIGIN: "https://${{web.RAILWAY_PUBLIC_DOMAIN}}",
      TRUST_PROXY: "true",
    },
  });

  // Nightly logical backup + monthly restore test (scripts/db-backup.js, see
  // "Backups" in DEPLOYMENT.md). A cron service: it starts at 22:00 UTC, which
  // is 02:00 at the park, runs to completion and stops. The dumps live on their
  // own volume, separate from the database volume they protect. Secrets are
  // referenced from the api service so each has one home.
  const backupVolume = volume("backup-volume", {
    alerts: { usage: { "80": {}, "95": {} } },
    region: "ams",
    sizeMB: 5000,
  });
  const dbBackup = service("db-backup", {
    source: github("Abdurrahman-gurib/valle-web-backend", { branch: "main" }),
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile.backup" },
    deploy: { cronSchedule: "0 22 * * *", restartPolicyType: "NEVER" },
    volumeMounts: { "/backups": backupVolume },
    env: {
      BACKUP_DIR: "/backups",
      BACKUP_CRON: "0 22 * * *",
      // Failures, and once a month the restore-test result.
      BACKUP_NOTIFY_TO: "abdurrahman@vallepark.com",
      MAIL_FROM: "VALLÉ Advenature Park <bookings@vallepark.com>",
      SMTP_URL: "${{api.SMTP_URL}}",
      SENTRY_DSN: "${{api.SENTRY_DSN}}",
      DB_HOST: Postgres.env.RAILWAY_PRIVATE_DOMAIN,
      DB_PORT: "5432",
      DB_USER: Postgres.env.PGUSER,
      DB_PASSWORD: Postgres.env.PGPASSWORD,
      DB_NAME: Postgres.env.PGDATABASE,
      DB_SSL: "no-verify",
    },
  });

  return project("valle-web", {
    resources: [web, api, Postgres, postgresVolume, dbBackup, backupVolume],
  });
});
