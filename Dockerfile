# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---- runtime ----
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
# Operator scripts and the SQL they apply, so `node scripts/db-init.js` runs
# inside this image: Railway's pre-deploy command (.railway/railway.ts) and any
# one-off shell (`railway ssh`). `pg` and `bcryptjs` are runtime dependencies.
COPY scripts ./scripts
COPY database/schema.sql database/seed.sql ./database/
COPY database/migrations ./database/migrations
EXPOSE 3001
USER node
# Liveness, not readiness: a database blip must not mark the container unhealthy
# and trigger a restart loop. Readiness (/api/health) is the orchestrator's probe.
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3001/api/health/live >/dev/null || exit 1
CMD ["node", "dist/main.js"]
