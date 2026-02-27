# infinitune

## Project Overview
Real-time AI music generation platform with a unified API/worker server.

## Mandatory Rules
- Use `pnpm` monorepo commands only; do not hardcode mixed-content-breaking `VITE_API_URL` defaults in CI/docker builds.

## Tooling
- `pnpm dev`
- `pnpm dev:all`
- `pnpm server`
- `pnpm check`, `pnpm typecheck`, `pnpm test`

## Ports
- Vite: `5173`
- Unified server: `5175`
- Registered in `/home/beasty/projects/.ports`
