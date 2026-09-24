#!/bin/sh
# Build-stage helper (Dockerfile): upload the compiled API's source maps to Sentry
# so production stack traces show TypeScript lines. Reads SENTRY_AUTH_TOKEN and
# SENTRY_RELEASE from the environment; does nothing when either is missing, so
# local and compose builds are unaffected. Kept in a script so the build log never
# echoes the token.
set -e
if [ -z "$SENTRY_AUTH_TOKEN" ] || [ -z "$SENTRY_RELEASE" ]; then
  echo "Sentry source maps: skipped (no token/release)"
  exit 0
fi
npx sentry-cli sourcemaps inject ./dist
npx sentry-cli sourcemaps upload --org valle-advenature-park --project valle-web-api --release "$SENTRY_RELEASE" ./dist
echo "Sentry source maps: uploaded for release $SENTRY_RELEASE"
