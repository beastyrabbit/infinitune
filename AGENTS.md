# infinitune

## Project Overview
Real-time AI music generation platform with a unified API/worker server.

## Mandatory Rules
- Use `pnpm` monorepo commands only; do not hardcode mixed-content-breaking `VITE_API_URL` defaults in CI/docker builds.

## Tooling
- `pnpm dev`
- `pnpm dev:all`
- `pnpm server`
- `pnpm dev:web:portless`
- `pnpm dev:server:portless`
- `pnpm dev:all:portless`
- `pnpm check`, `pnpm typecheck`, `pnpm test`

## Ports
- Vite: `5173` (fallback)
- Unified server: `5175` (fallback)
- Portless defaults: `web.localhost:1355` and `api.localhost:1355`
- Registered in `/home/beasty/projects/.ports`
