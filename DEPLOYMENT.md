# Deployment

Production runs on [Railway](https://railway.com) as the project **`valle-web`**
(workspace "noor gurib's Projects", environment `production`). Two GitHub
repositories feed it and every push to `main` deploys automatically.

| Railway service | Source                                                        | Exposure                                               |
| --------------- | ------------------------------------------------------------- | ------------------------------------------------------ |
| `web`           | https://github.com/Abdurrahman-gurib/valle-web-frontend       | public domain (the site)                               |
| `api`           | https://github.com/Abdurrahman-gurib/valle-web-backend (this) | private network only, `api.railway.internal:3001`      |
| `Postgres`      | Railway PostgreSQL template (`postgres-ssl`, TLS on)          | private network only, `postgres.railway.internal:5432` |

Public site: `https://web-production-ff60b.up.railway.app` (the Railway-provided domain of `web`; see
[Custom domain](#custom-domain) to put `vallepark.com` in front of it).

## Topology

```
browser --https--> Railway edge --> web (nginx, PORT 80)
                                     |  serves the built SPA
                                     |  /api/*        --> api.railway.internal:3001 (private network)
                                     |  /socket.io/*  --> api.railway.internal:3001 (WebSocket upgrade)
                                     v
                                    api (NestJS, PORT 3001) --TLS--> postgres.railway.internal:5432
```

- The site and the API share **one origin**. That is required, not cosmetic: the
  staff session cookie is `SameSite=Strict`, so a cross-origin API would never
  receive it. `VITE_API_URL` stays at its default `/api`.
- Railway's private network is IPv6 (dual-stack in newer environments), and a
  service gets a **new private address on every redeploy**. `main.ts` therefore
  listens on `::`, and nginx resolves `api.railway.internal` per request
  (`resolver` + a variable in `proxy_pass`, see `nginx.conf.template` in the
  frontend repo) instead of once at start-up.
- Railway's edge terminates TLS and reports the visitor in `X-Real-IP`. nginx
  forwards that as `X-Forwarded-For` (`TRUST_EDGE_HEADERS=1`), the API trusts one
  proxy hop (`TRUST_PROXY=true`), and so the rate limiters key on the real visitor.
- The API is pinned to **one replica** (`.railway/railway.ts`): live chat keeps
  socket state in memory. See [Scaling notes](#scaling-notes) before raising it.
- The whole project (services, sources, variables, healthchecks, the pre-deploy
  command, the database and its volume) is described in
  [`.railway/railway.ts`](.railway/railway.ts), Railway's infrastructure-as-code
  file, and applied with `railway config apply`. Railway's older `railway.json`
  is deprecated and no longer read for new services.

## CI/CD pipeline

```
git push origin main
   |
   +--> GitHub Actions (.github/workflows/ci.yml in each repo)
   |      backend:  tsc, unit tests, nest build, API e2e against a Postgres
   |                container bootstrapped with scripts/db-init.js, docker build
   |      frontend: tsc, vitest, vite build, docker build + `nginx -t` on the
   |                rendered template
   |
   +--> Railway GitHub autodeploy of that service
          1. builds the Dockerfile at the repo root
          2. api only: pre-deploy command `node scripts/db-init.js`
             (empty database -> schema + seed; otherwise a no-op)
          3. starts the new container and waits for the healthcheck
             (api: GET /api/health must answer 200, i.e. SELECT 1 works;
              web: GET / must answer 200)
          4. switches traffic, stops the old container
```

### Turning on automatic deploys (one-time, GitHub side)

Railway can only watch a repository its GitHub App has been granted. As of the
first deploy the app installed on the `Abdurrahman-gurib` account only covers
the WhatsApp bot repository, so the two services were connected and deployed
once by the CLI but **later pushes do not deploy until one of these is done**:

**Option A (recommended): Railway's GitHub integration.**

1. GitHub -> Settings -> Applications -> Installed GitHub Apps -> Railway ->
   Configure -> Repository access -> add `valle-web-frontend` and
   `valle-web-backend` -> Save.
2. Railway dashboard -> project `valle-web` -> service `api` -> Settings ->
   Source -> connect `Abdurrahman-gurib/valle-web-backend`, branch `main`.
   Same for `web` with `valle-web-frontend`. (Or, from a linked clone:
   `railway service source connect --repo Abdurrahman-gurib/valle-web-backend --branch main --service api`.)
3. In the same Source panel enable **Wait for CI**. A deployment then stays in
   `WAITING` until the GitHub workflow for that commit passes and is `SKIPPED`
   when it fails, so a red build never reaches production.

**Option B: deploy from GitHub Actions.** Both workflows end with a `deploy` job
that is skipped unless a `RAILWAY_TOKEN` repository secret exists. Create a
project token (Railway -> project `valle-web` -> Settings -> Tokens, environment
`production`), add it as `RAILWAY_TOKEN` under each repository's Settings ->
Secrets and variables -> Actions, and every green run on `main` uploads and
deploys that commit with `railway up`. Do not combine A and B, or each push
deploys twice.

Until one of these is done, deploy the latest `main` by hand:
`railway redeploy --service api --from-source --yes` (same for `web`).

Branches other than `main` and pull requests run CI only; nothing deploys.

## Service variables

Set on the Railway service (Variables tab, or
`railway variable set KEY=value --service <name>`). `${{Service.VAR}}` is
Railway's cross-service reference syntax and resolves at deploy time.

### `api`

| Variable            | Value                                    | Notes                                                                 |
| ------------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| `NODE_ENV`          | `production`                             | Strict boot checks (`src/config/env.ts`), Swagger off                  |
| `PORT`              | `3001`                                   | Also what nginx targets and what the healthcheck probes                |
| `DB_HOST`           | `${{Postgres.RAILWAY_PRIVATE_DOMAIN}}`   | `postgres.railway.internal`                                            |
| `DB_PORT`           | `5432`                                   | Internal port (the TCP-proxy port only exists for public access)       |
| `DB_USER`           | `${{Postgres.PGUSER}}`                   |                                                                       |
| `DB_PASSWORD`       | `${{Postgres.PGPASSWORD}}`               | Keep the reference, never paste the value                              |
| `DB_NAME`           | `${{Postgres.PGDATABASE}}`               |                                                                       |
| `DB_SSL`            | `no-verify`                              | TLS on; Railway's Postgres certificate is self-signed                  |
| `JWT_SECRET`        | 64 random characters                     | Set once; rotating it signs every operator out                         |
| `STAFF_COOKIE_NAME` | `valle_staff`                            |                                                                       |
| `CORS_ORIGIN`       | `https://${{web.RAILWAY_PUBLIC_DOMAIN}}` | Exact https origin(s), comma separated; add a custom domain here too   |
| `TRUST_PROXY`       | `true`                                   | One hop: the nginx container                                           |

The API refuses to start in production when `JWT_SECRET` is missing or short, when
`CORS_ORIGIN` is empty, contains `*` or uses `http://`, when `DB_PASSWORD` or
`DB_HOST` is unset, or when `DB_SSL` is not `true` / `no-verify`. That is
deliberate: each of those silently weakens the deployment.

### `web`

| Variable             | Value                       | Notes                                                          |
| -------------------- | --------------------------- | -------------------------------------------------------------- |
| `PORT`               | `80`                        | nginx listen port and the port the Railway domain targets       |
| `API_UPSTREAM`       | `api.railway.internal:3001` | `<api service name>.railway.internal:<api PORT>`                |
| `TRUST_EDGE_HEADERS` | `1`                         | Forward Railway's `X-Real-IP` / `X-Forwarded-Proto` to the API  |

`NGINX_RESOLVER` is derived from the container's `/etc/resolv.conf` at start-up;
set it only to override.

### `Postgres`

Provided by the template: `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`,
`PGDATABASE`, `DATABASE_URL`, `RAILWAY_PRIVATE_DOMAIN`. Data lives on the
attached Railway volume. Leave the database private; enable **Public
Networking** on it only while you need a laptop-side `psql`, and disable it
afterwards.

## Database

### Bootstrap

`scripts/db-init.js` is the `api` pre-deploy command, so it runs in the freshly
built image, with the service variables, before every deployment goes live:

- **empty database**: applies `database/schema.sql` then `database/seed.sql`
  (this is what populated production on the first deploy);
- **schema present but no content** (an earlier seed did not finish): applies
  `seed.sql`;
- **already initialised**: does nothing and exits 0.

It exits non-zero on any error, which fails the deployment instead of starting
an API against a half-built schema. `schema.sql` begins with `DROP TABLE`, so it
is only ever applied to an empty database: ship later schema changes as
migrations, never by re-running it.

### Running commands inside the api container

`railway ssh` needs an SSH key registered with your Railway account. One-time
setup on a new machine:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519      # skip if you already have one
railway ssh keys add                             # registers ~/.ssh/id_ed25519.pub
ssh-keyscan ssh.railway.com >> ~/.ssh/known_hosts   # non-interactive shells only
railway ssh --service api -- node scripts/db-init.js   # any command, or omit for a shell
```

### Re-seed content / reset

Both options are **destructive**. `seed.sql` truncates the content tables and
`staff_users` with `CASCADE`, and every transactional table references one of
those, so a re-seed deletes all bookings, booking lines, audit rows, chat
conversations and messages, and job applications; only quote requests survive.
Take a backup first (below), then run inside the api container (Railway CLI,
logged in and linked to the project):

```bash
railway ssh --service api -- sh -c "CONFIRM_RESEED=yes node scripts/db-init.js --reseed"
# content + staff logins replaced from seed.sql (and the cascades above)

railway ssh --service api -- sh -c "CONFIRM_RESET=yes node scripts/db-init.js --reset"
# drops EVERY table and rebuilds from schema + seed
```

Without the confirmation variable the script refuses and exits 1. Both restore
the published starter passwords for the staff accounts: rotate them again
afterwards (next section).

### Staff passwords

The seed creates `sales@vallepark.com`, `agent@vallepark.com` and
`hr@vallepark.com` with passwords that are published in this repository, so
they were rotated right after the first deploy. To rotate again:

```bash
railway ssh --service api -- node scripts/staff-password.js sales@vallepark.com
# generates a 20-character password and prints it once

railway ssh --service api -- node scripts/staff-password.js sales@vallepark.com "YourOwnPassword!"
# or set your own (12+ characters)
```

### Backups

Railway keeps the volume; take logical backups as well:

```bash
railway connect Postgres        # psql over an SSH tunnel to the private database
```

or, with **Public Networking** temporarily enabled on the Postgres service,
`pg_dump` against its `DATABASE_PUBLIC_URL`.

## Day-two operations

```bash
railway link                                    # once per clone: pick valle-web / production
railway service status                          # deployment status of every service
railway logs --service api --lines 200          # runtime logs (add --build for build logs)
railway logs --service web --http --lines 100   # edge request log
railway deployment list --service api           # history with ids
railway redeploy --service api --yes            # restart the current deployment without rebuilding
railway deployment rollback <id> --service api  # roll back to an earlier deployment
railway variable set KEY=value --service api    # change a variable (triggers a redeploy)
```

Deploys can also be triggered from the dashboard (**Deploy Latest Commit**) when
autodeploy is paused.

### Custom domain

```bash
railway domain vallepark.com --service web --port 80       # prints the DNS record to create
railway domain www.vallepark.com --service web --port 80
railway variable set 'CORS_ORIGIN=https://vallepark.com,https://www.vallepark.com,https://${{web.RAILWAY_PUBLIC_DOMAIN}}' --service api
```

Railway issues the TLS certificate once DNS resolves. Keep the Railway domain in
`CORS_ORIGIN` until the custom one is live, then drop it if you want a single
canonical origin.

## Recreating the project from scratch

The project is described in [`.railway/railway.ts`](.railway/railway.ts).
`railway config plan` diffs that file against the live project (read-only) and
`railway config apply` creates or updates whatever differs, so a fresh project
is a handful of commands plus the one secret:

```bash
railway login
railway init --name valle-web            # empty project, links this directory to it
npm install                              # the "railway" dev dependency provides railway/iac
railway config apply                     # Postgres + volume, web, api, variables, healthchecks, pre-deploy
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))" | railway variable set JWT_SECRET --stdin --service api
railway domain --service web --port 80   # public domain for the site
```

The api's first deployment fails its boot checks until `JWT_SECRET` is set;
setting it triggers the redeploy. Non-secret variables live in the file;
secrets are `preserve()`d, never written to source.

Windows note: with the CLI installed through npm, `railway config plan` /
`apply` fail with "requires Railway CLI 5.42.1 or newer" even on a current CLI,
because the SDK spawns `railway` without a shell and cannot run the npm `.cmd`
shim. Put the real executable first on `PATH` for that shell:

```powershell
$env:PATH = "$env:APPDATA\npm\node_modules\@railway\cli\bin;$env:PATH"
railway config plan
```

The equivalent manual CLI commands, for reference:

```bash
railway login
railway init --name valle-web
railway add --database postgres

# web first: api's CORS_ORIGIN references its public domain
railway add --repo Abdurrahman-gurib/valle-web-frontend --branch main --service web \
  --variables PORT=80 --variables API_UPSTREAM=api.railway.internal:3001 --variables TRUST_EDGE_HEADERS=1
railway domain --service web --port 80

railway add --repo Abdurrahman-gurib/valle-web-backend --branch main --service api \
  --variables NODE_ENV=production --variables PORT=3001 \
  --variables 'DB_HOST=${{Postgres.RAILWAY_PRIVATE_DOMAIN}}' --variables DB_PORT=5432 \
  --variables 'DB_USER=${{Postgres.PGUSER}}' --variables 'DB_PASSWORD=${{Postgres.PGPASSWORD}}' \
  --variables 'DB_NAME=${{Postgres.PGDATABASE}}' --variables DB_SSL=no-verify \
  --variables STAFF_COOKIE_NAME=valle_staff --variables TRUST_PROXY=true \
  --variables 'CORS_ORIGIN=https://${{web.RAILWAY_PUBLIC_DOMAIN}}'
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))" | railway variable set JWT_SECRET --stdin --service api
```

Connecting a GitHub repo requires the Railway GitHub App to be installed on the
GitHub account with access to both repositories (GitHub -> Settings ->
Applications -> Railway). Each service builds from the `Dockerfile` at its repo
root; every other deploy setting (healthcheck, pre-deploy command, replicas,
restart policy) comes from `.railway/railway.ts`, so change it there and run
`railway config apply` rather than editing the dashboard.

## Health probes

There are two, and they are not interchangeable:

| Probe     | Path               | Behaviour                                                                                                                                   |
| --------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Readiness | `/api/health`      | Runs `SELECT 1`: **200** `{ status: 'ok', db: true }` when the database answers, **503** `{ status: 'degraded', db: false }` when it does not |
| Liveness  | `/api/health/live` | **200** `{ status: 'ok' }`, never touches the database                                                                                      |

Railway's `healthcheckPath` (readiness) gates the traffic switch on each deploy.
The Docker `HEALTHCHECK` baked into the image is liveness: a database blip must
not restart the process, because the connection pool recovers on its own after a
failover.

## Before the first public deploy

1. **Staff passwords rotated** (done after the first deploy; rotate again after
   any `--reseed`).
2. `CORS_ORIGIN` points at the real domain(s) and nothing else.
3. Wire a real payment provider if you intend to take money online: the current
   "pay online" path records the intent and does not charge a card.
4. Watch the Railway metrics and HTTP logs for 5xx rates and login 429s; add an
   uptime monitor on `https://web-production-ff60b.up.railway.app/api/health`.

## Scaling notes

The chat gateway keeps socket state in memory, so **more than one API replica
needs a shared adapter** or a visitor and an agent can land on different
instances and never see each other. That is why `.railway/railway.ts` pins
`replicas` to 1, and it is the only supported setting until:

1. a Redis service reachable over the private network exists (`railway add --database redis`);
2. the socket.io Redis adapter is wired into the chat gateway;
3. only then raise `numReplicas`.

Two other per-instance details, neither a blocker: the catalog cache is
per-replica (each just misses once and refills), and the rate-limit counters
are in-memory, so budgets are effectively multiplied by the replica count
until the throttler gets the same Redis backing store. The static `web`
service holds no state and can scale freely.

## Alternative: Azure

The images also deploy unchanged to Azure. Three pieces: a PostgreSQL database,
the API container, and the static site container.

### Database: Azure Database for PostgreSQL Flexible Server

```bash
az postgres flexible-server create \
  --resource-group valle-rg --name valle-pg \
  --location southafricanorth \
  --tier Burstable --sku-name Standard_B1ms \
  --version 16 --storage-size 32 \
  --admin-user valleadmin --admin-password "<strong-password>" \
  --public-access None            # use a private endpoint or VNet integration
az postgres flexible-server db create -g valle-rg -s valle-pg -d valle_park
```

Load the schema and content once (`npm run db:init` with `DB_*` pointing at the
server does the same without psql):

```bash
psql "host=valle-pg.postgres.database.azure.com port=5432 dbname=valle_park \
      user=valleadmin sslmode=require" -f database/schema.sql -f database/seed.sql
```

Flexible Server enforces TLS with a publicly trusted chain, so set `DB_SSL=true`
(verify), not `no-verify`.

Create a least-privilege application role rather than connecting as the admin:

```sql
CREATE ROLE valle_app LOGIN PASSWORD '<app-password>';
GRANT CONNECT ON DATABASE valle_park TO valle_app;
GRANT USAGE ON SCHEMA public TO valle_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO valle_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO valle_app;
-- no CREATE/DROP: migrations run as the admin, the app never alters its own schema
```

### Secrets: Key Vault

```bash
az keyvault create -g valle-rg -n valle-kv
az keyvault secret set --vault-name valle-kv -n jwt-secret --value "$(openssl rand -base64 48)"
az keyvault secret set --vault-name valle-kv -n db-password --value "<app-password>"
```

Give the API a system-assigned managed identity, grant it `get` on secrets, and
reference them from App Settings:

```
JWT_SECRET=@Microsoft.KeyVault(SecretUri=https://valle-kv.vault.azure.net/secrets/jwt-secret/)
DB_PASSWORD=@Microsoft.KeyVault(SecretUri=https://valle-kv.vault.azure.net/secrets/db-password/)
```

### Containers

```bash
az acr build -r vallecr -t valle-api:$(git rev-parse --short HEAD) .   # in valle-web-backend
az acr build -r vallecr -t valle-web:$(git rev-parse --short HEAD) .   # in valle-web-frontend

az containerapp create -g valle-rg -n valle-api --environment valle-env \
  --image vallecr.azurecr.io/valle-api:<tag> --target-port 3001 --ingress internal \
  --min-replicas 1 --max-replicas 1
az containerapp create -g valle-rg -n valle-web --environment valle-env \
  --image vallecr.azurecr.io/valle-web:<tag> --target-port 80 --ingress external \
  --env-vars API_UPSTREAM=<valle-api internal FQDN>:3001 TRUST_EDGE_HEADERS=
```

Set the same `api` variables as on Railway, with `DB_SSL=true` and `DB_USER=valle_app`.
Container Apps' ingress does not set `X-Real-IP` the way Railway does, so leave
`TRUST_EDGE_HEADERS` empty there and rely on `TRUST_PROXY=true` on the API.

Probes:

```bash
az containerapp update -g valle-rg -n valle-api \
  --probe-type readiness --probe-path /api/health --probe-port 3001
az containerapp update -g valle-rg -n valle-api \
  --probe-type liveness --probe-path /api/health/live --probe-port 3001
```

## Error monitoring (Sentry)

Both apps carry the Sentry SDK and stay silent until a DSN is configured.
Create two projects in the Sentry org (React for the site, Node.js for the API),
then set on Railway:

- service `web` (build variables, Vite inlines them): `VITE_SENTRY_DSN`,
  `VITE_SENTRY_ENVIRONMENT=production`
- service `api`: `SENTRY_DSN`, `SENTRY_ENVIRONMENT=production`

Redeploy after setting them (`railway up` or a push to main). The site
reports unhandled errors with a session replay of the moments before, and one
page load or route change in five as a performance trace; the API reports 5xx
exceptions and one request in five. Request bodies and cookies are stripped
before sending, so booking and application data never leaves the platform.

## Search engines (technical SEO)

The public site is statically generated at build time (`scripts/prerender.mjs`
renders every public route with the bundled catalog), so crawlers get full HTML.
`/sitemap.xml` and `/robots.txt` are served by the API from the database, with
`lastmod` from the `updated_at` columns (bumped by trigger on every content edit).

Railway variables that matter:

- `web`: `VITE_SITE_URL` (build arg, declared in the Dockerfile) is the canonical
  origin written into canonical, Open Graph and hreflang tags. Set to
  `https://vallepark.com` on 2026-09-25, so even the railway.app deployment
  declares the custom domain as canonical (search engines then never index the
  railway.app URL). `CANONICAL_HOST` (runtime) makes nginx 301 every other
  hostname (www., the railway.app URL) to that host and upgrade http to https.
  Leave `CANONICAL_HOST` EMPTY until DNS for vallepark.com points at Railway:
  set earlier, the railway.app site would redirect visitors to the old site.
- `api`: `SITE_URL` is the origin used in the sitemap and robots.txt; set to
  `https://vallepark.com` on 2026-09-25. Unset, it follows the request host.
- `web`: `MAINTENANCE=1` answers every page 503 with `Retry-After` while keeping
  assets and the API up.

Old vallepark.com paths are mapped in `Frontend/redirects.map` (301, or 410 for
pages with no equivalent). Activity and restaurant pages exist only as
prerendered files, so adding an experience to the database needs a web rebuild
(push to the frontend repo) before its URL stops answering 404. Vacancy pages
are rendered by the app from the API and need no rebuild.

Go-live checklist for the custom domain: point DNS at Railway and add the
domain to the `web` service, then set `CANONICAL_HOST=vallepark.com` on `web`,
then the Search Console steps below. After launch, in Google Search Console: add the
property for the canonical domain, submit `https://<domain>/sitemap.xml`, and
run URL Inspection on the home page, `/explore`, `/packages` and two or three
activity pages. A sitemap helps discovery; indexing is Google's decision.
