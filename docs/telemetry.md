# Telemetry

Infinitune uses the homelab's Umami 3 and GlitchTip 6. Both are optional.
No consent banner, privacy-policy change or CSP is added for this private tool.

## Container configuration

Set these values on **both the frontend and server containers**:

| Variable | Production value | Purpose |
| --- | --- | --- |
| `UMAMI_URL` | `https://umami.heerlab.com` | Browser tracker/recorder and server event destination. |
| `UMAMI_WEBSITE_ID` | `16206c2c-c965-46db-8f19-4b60bd97adb6` | Public website ID. |
| `UMAMI_DOMAINS` | `infinitune.heerlab.com,192.168.60.30` | Exact allowed hostnames. First hostname identifies pipeline events. Exclude localhost and preview domains. |
| `GLITCHTIP_DSN` | `https://cf49ab783f0743d391431d325861ec1b@glitchtip.heerlab.com/7` | Public DSN; not an upload token. |
| `TELEMETRY_ENVIRONMENT` | `production` | SDK environment; image default is production, otherwise development. |
| `GLITCHTIP_TRACES_SAMPLE_RATE` | `0.1` | Fraction from 0 to 1; zero disables sampled request/browser traces. |

`INFINITUNE_RELEASE` is baked into both containers from the tag without `v`.
Do not override it in Kubernetes. Local builds default to `dev`; workflow
dispatch uses the commit SHA. SDK and source-map release values must match.
The existing `APP_ORIGIN` and server trusted-proxy settings remain required.

`TELEMETRY_ENABLED=true` explicitly opts non-production server/CLI processes in.
Missing DSNs disable Sentry. Missing Umami URL, ID or domains disables analytics.
`NODE_ENV=test` or `VITEST=true` always disables telemetry. Browser development
builds and WebDriver automation never send browser telemetry.

The frontend root loader reads an allowlist from its environment at request
time. TanStack Start serializes only public configuration to the browser.
There are no `VITE_*` telemetry variables. The unified server reads its own
environment. Neither container needs admin credentials or an upload token.

The CLI and daemon use **environment configuration**, not an API lookup.
Set `GLITCHTIP_DSN`, `TELEMETRY_ENVIRONMENT=production`,
`INFINITUNE_RELEASE=<deployed-version>`, `GLITCHTIP_TRACES_SAMPLE_RATE=0.1`
and `TELEMETRY_ENABLED=true` in the terminal or systemd service environment.
The CLI does not send Umami events.

## SDK initialization and privacy

The Hono entry imports instrumentation before application imports. The shared
Node SDK also initializes from the frontend server entry and Nitro plugin.
Hono errors, Nitro errors, failed Start requests, unhandled exceptions and
rejections are captured. Pino error logs are captured without arbitrary fields.
Start's global function middleware also reports errors returned by server
functions, which can otherwise be serialized into successful HTTP responses.
Repeated captures of the same Error object are suppressed. Song-scoped pino
errors are reported once through the pipeline failure status transition with
song/playlist/stage/provider/model tags. CLI errors flush before exit; the
daemon flushes on shutdown. Node request spans have fixed names and collect no
request bodies or identity headers.

The browser imports `@sentry/react` dynamically after a 100 ms post-mount timer.
It captures unhandled errors/rejections, console errors and the root router
React error boundary. Boundary errors queue until initialization. Browser
tracing does not propagate headers to external providers. SDK 10 supports the
requested `sendDefaultPii: false` setting in every runtime.
Browser session tracking is disabled because GlitchTip does not support Sentry
session envelopes, as documented in its JavaScript SDK guide.

The shared scrubber filters auth/cookie/token headers, Pangolin `Remote-*`
headers, emails, bearer/basic tokens, JWTs, secret query parameters and share
tokens. User objects, request bodies, extras, locals and breadcrumb data are
filtered. Do not place user content in exception messages: a scrubber cannot
infer arbitrary prose is a prompt. Pipeline exception messages are generic.

Analytics properties use a scalar allowlist. Prompts become lengths; no lyrics,
identities, device names or raw provider errors are sent. There is no identify
call. Song/playlist IDs are random application identifiers. Pageviews have a
static title, no referrer, query or fragment, and redacted share paths. The
browser queue holds 50 events. Server delivery has four concurrent slots, a
1.5-second timeout, no retry queue and an injectable transport. Failure never
stops generation.

## Replay and heatmaps

Both served scripts were inspected on 2026-10-21. `script.js` supports
`data-domains`, `data-before-send`, `data-exclude-search`, `data-exclude-hash`,
`data-performance=true`, `track`, `identify`, `getSession` and event attributes.
Its History API patch handles TanStack Router links. The wrapper also tracks
`popstate`, which this served script omits, for browser back/forward navigation.
Outbound links use our
wrapper because this version has no automatic outbound option. Performance
includes TTFB, FCP, LCP, CLS, INP and page duration.

`recorder.js` obtains policy from `GET /api/websites/<website-id>/recorder`.
Script attributes cannot override its masking. The app requires `enabled`,
`maskLevel: "strict"` and `[data-telemetry-private]` in `blockSelector` before
loading it. Configure that website with:

```json
{
  "enabled": true,
  "replayEnabled": true,
  "heatmapEnabled": true,
  "sampleRate": 0.15,
  "heatmapSampleRate": 0.15,
  "maskLevel": "strict",
  "blockSelector": "input,textarea,select,[data-telemetry-private]"
}
```

The orchestrator must expose this read-only recorder-policy endpoint through
Pangolin with CORS access, alongside the public scripts and ingestion endpoints.
It returned **HTTP 401** during implementation, so live replay remains off
until fixed. No admin API was called. Umami owns sampling policy.

Strict mode masks all text and inputs; the body also has `rr-mask`. A narrow
fetch guard filters only `/api/record` requests, masks text/input payloads,
allowlists DOM attributes and strips query/hash/share tokens from replay and
heatmap URLs. Oversized fragmented snapshots are dropped because individual
fragments cannot be inspected safely; this can leave gaps in large-page replay.
Initial sensitive routes or query/hash URLs do not start recording. Mark future
personal UI regions with `data-telemetry-private`.

The inspected tracker sets no cookies or storage. It reads the optional
`localStorage["umami.disabled"]` opt-out; its cache remains in memory. The
configured Sentry integrations also use memory and set no cookies/storage.
The browser test first asserts empty cookie/localStorage/sessionStorage lists.
After real app navigation, sessionStorage contains only the existing application
keys `infinitune-radio-listener-id` and `tsr-scroll-restoration-v1_3`.

## Event catalog

| Name | Fired at | Properties |
| --- | --- | --- |
| pageview, unnamed event | Initial document and SPA navigation | Sanitized path, hostname, static title, screen, language; no referrer. |
| performance | Umami observer | TTFB, FCP, LCP, CLS, INP, duration. |
| `playlist_created` | Successful browser create; server bus | Browser: source, prompt_length, mode. Server: source, playlist_id. |
| `playlist_steered` | Successful browser prompt mutation; server bus | Browser: source, playlist_id, prompt_length. Server: source, playlist_id, epoch. |
| `playlist_status_changed` | Browser status mutation, including closed | playlist_id, status. |
| `song_play`, `song_complete` | Global audio play/ended | song_id when available. |
| `song_skip` | Successful radio skip; room skip command | source=radio or room. |
| `song_rate` | Successful song rating/radio feedback | song_id, rating; radio also source. |
| `room_join` | Room WebSocket connects, join sent | role=player/controller. Reconnects count. |
| `song_request` | Successful pending/interrupt or radio request | playlist_id, is_interrupt, prompt_length; radio: source, prompt_length. |
| `settings_changed` | Successful settings mutation | No settings names or values. |
| `mutation_error` | Mutation factory rejects | source category, error_class. |
| `playback_error` | Audio error event | song_id, MediaError code as error_class. |
| `outbound_link` | External HTTP(S) anchor click | hostname only. |
| `song_generation_started` | pending to generating_metadata | source=server, song_id, playlist_id, provider, model, stage, duration_ms. |
| `song_generation_completed` | saving to ready | Same pipeline properties. |
| `song_generation_failed` | Any error/retry_pending transition | Same properties plus error_class=PipelineError, status. Also GlitchTip exception tags. |

Use source=server for complete playlist counts including CLI/API callers.

## Source maps and verification

Only the client Vite environment emits hidden maps. Docker injects Sentry
debug IDs, copies assets/maps into the `sourcemaps` stage, then removes every
map from `.output` before the runtime copy. Exported JS accompanies the maps
for artifact upload and matches the debug-ID-injected runtime JavaScript.

The image job retains semver, major.minor, short-SHA and latest tags. A separate
tag-only source-map job runs after publication and reuses its Buildx cache.
It declares `environment: production`, OIDC write permission and reads only
Infisical `infinitune/prod/ci`. It creates the release, uploads to the LAN
GlitchTip API and finalizes it. Failures fail that job without preventing image
publication. The upload token never enters a build arg, layer or artifact.
The uploader stays on Sentry CLI 2.58.6 and uses release-file upload APIs.
Sentry CLI 3 removed those commands. Debug IDs are injected by the same pinned
CLI version used for upload.

Run `pnpm check`, `pnpm typecheck`, `pnpm test` and
`pnpm --filter @infinitune/web test:e2e`. E2E builds and starts production Nitro,
mocks the captured tracker and GlitchTip envelopes, and blocks remote Node and
browser transports. It overrides WebDriver only for the human-path scenarios.
Recorder execution is stubbed; synthetic payload sanitization is unit tested.
Tests never call AI providers or live telemetry.

Production builds regenerate the tracked route tree without development-only
testlab routes. Restore that generated file before workspace typechecking,
which includes those development route sources.
