#!/bin/sh
set -e

require_app_origin() {
  process_name="$1"

  if [ -z "${APP_ORIGIN:-}" ]; then
    echo "ERROR: APP_ORIGIN is required for the production $process_name process."
    exit 1
  fi

  if ! node -e '
    try {
      const url = new URL(process.env.APP_ORIGIN);
      const isHttp = url.protocol === "http:" || url.protocol === "https:";
      const isOriginOnly =
        !url.username &&
        !url.password &&
        url.pathname === "/" &&
        !url.search &&
        !url.hash;
      if (!isHttp || !isOriginOnly) process.exit(1);
    } catch {
      process.exit(1);
    }
  '; then
    echo "ERROR: APP_ORIGIN must be an absolute HTTP(S) origin for the production $process_name process (for example, https://music.example.com)."
    exit 1
  fi
}

case "$PROCESS_TYPE" in
  server)
    require_app_origin server
    exec node_modules/.bin/tsx apps/server/src/index.ts
    ;;
  frontend)
    require_app_origin frontend
    exec node apps/web/.output/server/index.mjs
    ;;
  *)
    echo "ERROR: Unknown PROCESS_TYPE '$PROCESS_TYPE'. Must be 'server' or 'frontend'."
    exit 1
    ;;
esac
