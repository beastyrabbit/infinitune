# Development notes

Use the repository's `pnpm` commands for Node tooling. On bunux, verified
2026-10-17, `npx` and `npm` resolve to `/home/beasty/.vite-plus/bin`; invoking
them directly can select a different runtime from the workspace. Prefer
`pnpm exec`, `pnpm --filter <workspace> exec`, or a package-local binary. The
workspace currently pins `better-sqlite3` 12.11.x in `package.json`.

The Portless development commands keep the web app on
`web-infinitune.localhost:1355` and the unified server on
`api-infinitune.localhost:1355`. For fixed-port fallback, run
`pnpm dev:all:fallback`: the web process uses port 5173 and the server uses
5175. The web Vite config and unified server both read `PORT`, so keep the
per-process environment from the checked-in fallback scripts when overriding
these defaults.

Production builds intentionally leave `VITE_API_URL` empty. The browser derives
the API and WebSocket origins from the page origin, which keeps HTTPS
deployments same-origin. Do not add a `VITE_API_URL` build argument or Docker
default for production.
