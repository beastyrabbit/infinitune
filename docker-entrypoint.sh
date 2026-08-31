#!/bin/sh
set -e

require_app_origin() {
  process_name="$1"

  if [ -z "${APP_ORIGIN:-}" ]; then
    echo "ERROR: APP_ORIGIN is required for the production $process_name process."
    exit 1
  fi

  case "$APP_ORIGIN" in
    *\?*|*\#*)
      echo "ERROR: APP_ORIGIN must be an absolute HTTP(S) origin for the production $process_name process (for example, https://music.example.com)."
      exit 1
      ;;
  esac

  if ! node -e '
    try {
      const raw = process.env.APP_ORIGIN;
      const url = new URL(raw);
      const isHttp = url.protocol === "http:" || url.protocol === "https:";
      const hasOriginOnlySyntax = /^https?:\/\/[^\s/?#@\\]+\/?$/i.test(raw);
      const isOriginOnly =
        !url.username &&
        !url.password &&
        url.pathname === "/" &&
        !url.search &&
        !url.hash;
      if (!isHttp || !hasOriginOnlySyntax || !isOriginOnly) process.exit(1);
    } catch {
      process.exit(1);
    }
  '; then
    echo "ERROR: APP_ORIGIN must be an absolute HTTP(S) origin for the production $process_name process (for example, https://music.example.com)."
    exit 1
  fi
}

require_trusted_proxy_ips() {
  if ! node -e '
    const { BlockList, isIP } = require("node:net");
    const entries = (process.env.RATE_LIMIT_TRUSTED_PROXY_IPS || "")
      .split(",")
      .map((entry) => entry.trim());
    if (entries.some((entry) => !entry)) process.exit(1);

    const blockList = new BlockList();
    for (const entry of entries) {
      const parts = entry.split("/");
      const rawAddress = parts[0].trim();
      const address = rawAddress.startsWith("::ffff:")
        ? rawAddress.slice(7)
        : rawAddress;
      const version = isIP(address);
      if (!version || parts.length > 2) process.exit(1);
      const family = version === 6 ? "ipv6" : "ipv4";
      try {
        if (parts.length === 1) {
          blockList.addAddress(address, family);
          continue;
        }
        if (!parts[1].trim()) process.exit(1);
        const prefix = Number(parts[1]);
        const maxPrefix = version === 6 ? 128 : 32;
        if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
          process.exit(1);
        }
        blockList.addSubnet(address, prefix, family);
      } catch {
        process.exit(1);
      }
    }
  '; then
    echo "ERROR: RATE_LIMIT_TRUSTED_PROXY_IPS must contain valid comma-separated IP addresses or CIDRs for the production server process."
    exit 1
  fi
}

case "$PROCESS_TYPE" in
  server)
    require_app_origin server
    require_trusted_proxy_ips
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
