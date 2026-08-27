#!/bin/sh
set -e

case "$PROCESS_TYPE" in
  server)
    exec node_modules/.bin/tsx apps/server/src/index.ts
    ;;
  frontend)
    if [ -z "${APP_ORIGIN:-}" ]; then
      echo "ERROR: APP_ORIGIN is required for the production frontend process."
      exit 1
    fi
    exec node apps/web/.output/server/index.mjs
    ;;
  *)
    echo "ERROR: Unknown PROCESS_TYPE '$PROCESS_TYPE'. Must be 'server' or 'frontend'."
    exit 1
    ;;
esac
