# Telemetry implementation verification

Verified locally on 2026-10-21, from `67eb56a` on `feat/umami-glitchtip`.
Production was not deployed or changed. No admin API, live AI provider, source-map
upload, push, tag or pull request was used.

## Results

| Check | Result |
| --- | --- |
| `pnpm check` | PASS, 328 files. |
| `pnpm typecheck` | PASS, CLI/server/web. Restored the production-generated route tree to its tracked development form first. |
| `pnpm test` | PASS, 697 tests: CLI 29, web 84, server 584; 80 test files. |
| `pnpm --filter @infinitune/web build` | PASS, full client/SSR/Nitro build. Also run by the E2E script. |
| `pnpm --filter @infinitune/web test:e2e` | PASS, all four production-browser scenarios, 6.7 seconds excluding build. |
| Full `docker build` | PASS, `infinitune-telemetry:verified`, release `telemetry-local`. |
| Buildx `--target sourcemaps --output type=local` | PASS, 41 maps with nonempty mappings and matching debug IDs. |
| Runtime image artifact inspection | PASS, zero `.map` files in `.output/public`; every one of the 41 exported JS files matches the runtime file's SHA256. |
| Runtime container frontend | PASS, `/autoplayer` returns HTTP 200 and SSR contains the baked runtime release. Verification container stopped and removed. |
| Uploader container | PASS, `getsentry/sentry-cli:2.58.6 --version` reports `sentry-cli 2.58.6`. |
| Workflow YAML | Parsed and checked job dependency, production environment and OIDC permission locally. Not executed on GitHub. |
| Secret scan | Staged gitleaks checks and commit hooks pass. |

Browser tests use an archived copy of the actual served Umami tracker and
mock all external requests. Node HTTP/fetch are also blocked outside loopback.
The tests demonstrate allowed-domain pageviews, TanStack navigation, query/hash
redaction, no tracking without configuration/on excluded domains/under WebDriver,
and an unhandled browser exception delivered to a mocked GlitchTip envelope
endpoint with the expected release and environment and without test PII.
Back/forward navigation is covered by an explicit browser-back assertion.
Session envelopes are disabled. Cookies and telemetry storage remain empty;
real app navigation adds only its existing radio and router session keys.

The tracker fixture SHA256 is
`654f12c7548be726eba5b71d5ef8bffc2a41a39a0053e2a49a847869ccd7ac3f`.
Recorder execution is stubbed in E2E; synthetic rrweb sanitization is unit tested.
Unit tests also cover queue bounds, disabled SDKs, property sanitization,
credentials/headers/encoded URL secrets, timeout/concurrency handling, repeated
pipeline failures and server-function errors.

## Bundle sizes

Vite reports decimal kB. Source maps are excluded from these numbers.

| Asset | Before | After | Change |
| --- | --- | --- | --- |
| Main entry, raw | 418.55 kB | 427.95 kB | +9.40 kB, 2.25% |
| Main entry, gzip | 133.51 kB | 137.01 kB | +3.50 kB, 2.62% |
| Deferred Sentry SDK, raw/gzip | Absent | 148.62 / 50.49 kB | Imported after the post-mount timer. |

The initial namespace import produced a 484.86 kB deferred SDK chunk.
A named-export adapter reduced it to the size above. No SDK import occurs when
the DSN is absent or browser telemetry is disabled.

The baseline client build completed, but its SSR build failed with:

```text
[vite]: Rollup failed to resolve import "nitro/app"
```

The pinned nightly package has a different package name from that self-import.
A narrow Vite alias fixes it. Vite's entry import-analysis also required the
top-level hidden sourcemap setting; an environment-only setting yielded an empty
main-entry map. SSR and Nitro sourcemaps remain explicitly disabled.

Existing build output includes TanStack's `inputValidator()` deprecation and
bundled dependencies' ignored `use client` directives. Dependency installation
also reports OpenTelemetry 2.12.0 peer-range warnings against API 1.10.0. They did
not fail the builds, runtime startup or checks above. No failing check remains.

## Live prerequisites and limits

The read-only Umami recorder-policy request returned this exact curl error:

```text
curl: (22) The requested URL returned error: 401
```

Expose `/api/websites/16206c2c-c965-46db-8f19-4b60bd97adb6/recorder` with
browser CORS access and set the strict policy documented in
[telemetry.md](telemetry.md). Until then, analytics and error reporting can work,
but replay/heatmaps fail closed. The app does not administer Umami policy.
Oversized fragmented recordings are dropped by the privacy guard.

The real GlitchTip ingestion and release upload were not exercised. Only stubbed
ingestion, local injection/export and the pinned uploader binary were checked.
The orchestrator must add the documented environment variables to both
containers and run a tag build to verify the OIDC-bound upload job.

## Files changed

Runtime and tests:

```text
apps/cli/package.json
apps/cli/src/cli.ts
apps/cli/src/daemon/runtime.ts
apps/cli/src/telemetry.ts
apps/server/package.json
apps/server/src/index.ts
apps/server/src/logger.ts
apps/server/src/telemetry/events.test.ts
apps/server/src/telemetry/events.ts
apps/server/src/telemetry/instrument.ts
apps/server/src/telemetry/sentry.test.ts
apps/server/src/telemetry/umami.test.ts
apps/server/src/telemetry/umami.ts
apps/web/package.json
apps/web/playwright.config.ts
apps/web/e2e/fixtures/umami-script.js
apps/web/e2e/offline.mjs
apps/web/e2e/telemetry.spec.ts
apps/web/src/hooks/useRoomConnection.ts
apps/web/src/integrations/api/hooks.ts
apps/web/src/lib/telemetry/Telemetry.tsx
apps/web/src/lib/telemetry/browser.test.ts
apps/web/src/lib/telemetry/browser.ts
apps/web/src/lib/telemetry/config.ts
apps/web/src/lib/telemetry/instrument.server.ts
apps/web/src/lib/telemetry/nitro.ts
apps/web/src/lib/telemetry/recorder.ts
apps/web/src/lib/telemetry/sentry-sdk.ts
apps/web/src/lib/telemetry/sentry.ts
apps/web/src/lib/telemetry/telemetry.test.ts
apps/web/src/routes/__root.tsx
apps/web/src/server.ts
apps/web/src/start.test.ts
apps/web/src/start.ts
apps/web/vite.config.ts
packages/shared/package.json
packages/shared/src/telemetry-node.ts
packages/shared/src/telemetry.ts
```

Build and documentation:

```text
.dockerignore
.github/workflows/build.yaml
.gitignore
Dockerfile
pnpm-lock.yaml
pnpm-workspace.yaml
README.md
docs/telemetry.md
docs/telemetry-verification.md
```

The generated route tree is unchanged. ByteFleet-managed MCP files are untouched.
