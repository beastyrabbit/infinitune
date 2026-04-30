# infinitune

## Project Overview
Real-time AI music generation platform with a unified API/worker server.

## Mandatory Rules
- Use `pnpm` monorepo commands only; do not hardcode mixed-content-breaking `VITE_API_URL` defaults in CI/docker builds.

## Tooling
- `pnpm dev`
- `pnpm dev:all`
- `pnpm dev:web`
- `pnpm dev:server`
- `pnpm dev:web:portless`
- `pnpm dev:server:portless`
- `pnpm dev:all:portless`
- `pnpm dev:web:fallback`
- `pnpm dev:server:fallback`
- `pnpm dev:all:fallback`
- `pnpm check`, `pnpm typecheck`, `pnpm test`

## Ports
- Vite: `5173` (fallback)
- Unified server: `5175` (fallback)
- Portless defaults: `web-infinitune.localhost:1355` and `api-infinitune.localhost:1355`
- Registered in `/home/beasty/projects/.ports`
