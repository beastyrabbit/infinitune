# Telemetry verification

Round 2 verified locally on 2026-10-21 on `feat/umami-glitchtip`, starting at
`139a9c2`. No push, tag, PR, deployment, admin API, live AI provider or live
telemetry request was used in this round.

## Checks

| Check | Result |
| --- | --- |
| `pnpm check` | PASS, 334 files. |
| `pnpm typecheck` | PASS, CLI/server/web. Production builds regenerate the route tree; restored its tracked development form before checking. |
| `pnpm test` | PASS, 724 tests across 85 files: CLI 29, server 604, web 91. |
| `pnpm --filter @infinitune/web test:e2e` | PASS, four production-browser scenarios, 6.9 seconds excluding build. |
| `pnpm --filter @infinitune/web build` | PASS, client/SSR/Nitro. |
| `docker build --target runtime` | PASS, image `infinitune-telemetry:round2`, release `telemetry-round2-local`, image ID `sha256:4e88795838b863539034b88e2ac68e2ee32bb518759692a3fe212dea4a9cd6f1`. |
| `docker build --target sourcemaps --output type=local,...` | PASS, 41 maps with nonempty mappings and matching JavaScript debug IDs. |
| Runtime asset verification | PASS, all 41 exported JavaScript files match the runtime image by SHA256; zero `.map` files anywhere in runtime `.output`. |
| Actionlint | PASS using `rhysd/actionlint:latest` with a local config declaring the existing `arc-infinitune` self-hosted runner label. The unconfigured run rejected only that label. |
| Gitleaks | PASS on the outgoing round-2 commit range. |

Initial type errors in the new Router and Sentry test fixtures were corrected;
the final typecheck passes. Build output still includes existing dependency
`use client` and TanStack `inputValidator()` deprecation warnings.

Unit tests cover failed root configuration, reuse across real Router navigation,
SSR root-error document markup, probe/WebSocket filtering, route-pattern span
names, original worker exceptions at metadata/audio/save stages for both retry
and terminal transitions, pino deduplication, scrubbed bounded messages, and
source-map verification rejecting changed/missing JavaScript or missing maps.

E2E uses the archived served Umami tracker, mocks browser telemetry and blocks
external Node transports. Settings navigation succeeds with server-function
requests blocked and makes no such requests. Pageviews, back/forward navigation,
privacy scrubbing, empty telemetry storage and disabled configurations also pass.
Recorder execution is stubbed; synthetic rrweb payloads are unit tested.

## Publication safeguards

The upload job remains separate and tag-only with `environment: production`.
Its OIDC identity requires subject
`repo:beastyrabbit/infinitune:environment:production`.
[GitHub's workflow syntax reference](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idenvironment)
permits expressions in environment names but does not establish that an empty
name omits the environment. Dispatch image publication therefore uses no
environment. Upload failure cannot prevent image publication.

Before fetching the upload token, the job pulls the published image by digest,
extracts its public assets and compares the full JavaScript path/SHA256 manifest
with the rebuilt export. A cache miss is safe: differing assets stop upload.
No real GitHub job, OIDC exchange or GlitchTip upload was exercised locally.

## External replay dependency

The configured Umami policy has replay/heatmaps enabled, both sampling rates
at 1, strict masking, a 1,800,000 ms maximum duration and
`blockSelector: "input,textarea,select,[data-telemetry-private]"`.
The handoff confirms LAN HTTP 200 at
`http://192.168.60.67:3000/api/websites/16206c2c-c965-46db-8f19-4b60bd97adb6/recorder`.

The equivalent public path under `https://umami.heerlab.com` still returns
HTTP 401 through Pangolin SSO. Replay and heatmaps fail closed until the
homelab operator exposes the read-only policy endpoint with browser CORS access
in the shared Pangolin blueprint. This repository does not own that change.
See [telemetry.md](telemetry.md) for the complete configured policy.
