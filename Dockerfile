# ── Stage 1: base ──────────────────────────────────────────────
FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
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
ARG VITE_API_URL=http://localhost:5175
ENV VITE_API_URL=${VITE_API_URL}

RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @infinitune/web build

# ── Stage 3: prod-deps ─────────────────────────────────────────
FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod
# tsx is a devDep but needed at runtime to run the server (TypeScript)
RUN pnpm add -w tsx

# ── Stage 4: runtime ───────────────────────────────────────────
FROM node:22-slim AS runtime

RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg tini && \
    rm -rf /var/lib/apt/lists/*

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

EXPOSE 3000 5175

ENTRYPOINT ["tini", "--"]
CMD ["./docker-entrypoint.sh"]
