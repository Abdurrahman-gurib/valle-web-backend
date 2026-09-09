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
      DB_HOST: Postgres.env.RAILWAY_PRIVATE_DOMAIN,
      DB_PORT: "5432",
      DB_USER: Postgres.env.PGUSER,
      DB_PASSWORD: Postgres.env.PGPASSWORD,
      DB_NAME: Postgres.env.PGDATABASE,
      DB_SSL: "no-verify",
      JWT_SECRET: preserve(),
      STAFF_COOKIE_NAME: "valle_staff",
      CORS_ORIGIN: "https://${{web.RAILWAY_PUBLIC_DOMAIN}}",
      TRUST_PROXY: "true",
    },
  });

  return project("valle-web", {
    resources: [web, api, Postgres, postgresVolume],
  });
});
