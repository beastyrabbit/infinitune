# ── Stage 1: base ──────────────────────────────────────────────
FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/room-client/package.json packages/room-client/package.json

# ── Stage 2: build ─────────────────────────────────────────────
FROM base AS build

# VITE_API_URL is baked into the client JS bundle at build time
ARG VITE_API_URL=
ENV VITE_API_URL=${VITE_API_URL}

RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @infinitune/web build

# ── Stage 3: prod-deps ─────────────────────────────────────────
FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod

# ── Stage 4: runtime ───────────────────────────────────────────
FROM node:22-slim AS runtime
ENV NODE_ENV=production
ENV INFINITUNE_PI_AGENT_DIR=/app/data/.infinitune/pi

ARG YT_DLP_VERSION=2026.08.19
ARG YT_DLP_SHA256=58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a

RUN apt-get update && \
	apt-get install -y --no-install-recommends ffmpeg tini ca-certificates curl && \
	curl --fail --silent --show-error --location \
		"https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/yt-dlp_linux" \
		--output /usr/local/bin/yt-dlp && \
	echo "${YT_DLP_SHA256}  /usr/local/bin/yt-dlp" | sha256sum --check --strict && \
	chmod 0755 /usr/local/bin/yt-dlp && \
	apt-get purge -y --auto-remove curl && \
	rm -rf /var/lib/apt/lists/*

RUN npm install -g @openai/codex@0.111.0

WORKDIR /app

# Production node_modules (includes tsx)
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=prod-deps /app/packages/room-client/node_modules ./packages/room-client/node_modules
COPY --from=prod-deps /app/apps/server/node_modules ./apps/server/node_modules

# Server source (runs via tsx at runtime)
COPY apps/server ./apps/server
COPY packages/shared ./packages/shared
COPY packages/room-client ./packages/room-client

# Web build output (Nitro SSR bundle)
COPY --from=build /app/apps/web/.output ./apps/web/.output

# Workspace package.json files (needed for module resolution)
COPY package.json pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/server/package.json ./apps/server/package.json

# Entrypoint
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Data directory for SQLite + covers (server resolves to /app/data via relative path)
RUN mkdir -p /app/data

# Verify tsx binary exists (fail build early rather than at runtime)
RUN test -x node_modules/.bin/tsx
RUN test -x /usr/local/bin/codex
RUN test -x /usr/local/bin/yt-dlp
RUN test -x /usr/bin/ffprobe

EXPOSE 3000 5175

ENTRYPOINT ["tini", "--"]
CMD ["./docker-entrypoint.sh"]
