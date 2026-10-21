# Infinitune privacy inventory

Reviewed on 21 October 2026 for round 3 on `feat/legal-pages`. The pages use the shared legal templates and are not legal advice. This inventory distinguishes the production evidence supplied by the orchestrator from changes in this candidate. No production settings, credentials or infrastructure were changed by this implementation task.

## Evidence and production scope

- Re-read `/home/beasty/.local/share/legal-pages-rollout/facts.md`, both Impressum templates, both privacy templates and `brief.md`. Per-site contacts are impressum-infinitune@heerlab.com and datenschutz-infinitune@heerlab.com; contact-form links use https://beastyrabbit.com/kontakt?from=infinitune.
- Orchestrator's live-pod inspection of version 1.3.0: textProvider/personaProvider `openai-codex`, textModel/personaModel `gpt-6-sol`; Pi credentials only for a consumer ChatGPT/Codex OAuth account, not an API account with a DPA. OpenRouter key empty. No account training-setting claim is made.
- Live database evidence supplied by orchestrator: 1 user, 11 playlists, 206 songs, last song 2026-03-07; zero songs with source_url; zero agent runs/messages/memory, radio plays, share links or registered devices.
- ACE-Step at `192.168.10.242:8001` and Ollama at `192.168.10.120:11434` are the operator's own LAN hardware in Germany. Audio is written to the operator's NAS at `/music/media/AI-Music`.
- imageProvider `comfyui` normalizes to `inference-sh`, but no inference.sh credentials or configuration exist in the pod. Last cover write 2026-03-06. No image-provider use is represented as active.
- Before this candidate, 112 server log files, 130 MB, dated since 2026-02-21 had no expiry. This candidate adds cleanup at startup and alongside the existing 15-second trim job.
- Earlier anonymous live inspection returned Unauthorized. It established neither authenticated browser storage nor HttpOnly cookies. The Pangolin cookie facts below are instead verified by the orchestrator from live config and Pangolin source.
- This round checked Umami read-only: deployment manifest has no retention settings; live pod reported no environment-variable names matching RETENTION, CLEANUP or DELETE_AFTER; the live tools namespace CronJob list contained only `pangolin-crowdsec-allowlist`. No verified analytics cleanup interval was found, so the authorized no-fixed-period wording is used. No secret values were printed.

## Active processing inventory

Legal basis for the listed service operations is Art. 6(1)(f) GDPR, as decided for this invited-user service. Necessary access/playback/preferences storage is classified under § 25(2) no. 2 TDDDG. The table records the adopted basis, not proof of consent or an independent legal assessment.

| Data category | Source | Purpose | Legal basis | Recipient | Country / transfer mechanism | Retention | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IP, time, method, path/query, protocol, status, size, duration, target service, TLS, user agent, forwarded IP | Browser through Traefik/Pangolin | Delivery and security | Art. 6(1)(f) | Operator; netcup GmbH, Emmy-Noether-Straße 10, 76131 Karlsruhe, processor | Germany; TLS terminates in Nuremberg, WireGuard to homelab | Traefik 14 days; Pangolin HTTP 14 days, auth 90 days, network 30 days | Shared facts/templates; [netcup imprint](https://www.netcup.com/de/kontakt/impressum); orchestrator must confirm shared retention readiness before delivery |
| Username, email, roles, login time/IP and session cookie | Pocket-ID/Pangolin | Restrict access to invited people | Art. 6(1)(f); § 25(2) no. 2 TDDDG for cookie | Operator, self-hosted SSO | Germany | Profile while access granted, deleted on request or after withdrawal; sign-in logs 90 days; resource cookie 30 days; backups ≤3 months | Uniform SSO wording in facts.md; orchestrator live config/source verification: Pangolin ee-1.24.0, server/auth/sessions/resource.ts and server/lib/readConfigFile.ts |
| Pangolin ID, email/display name; internal ID, created/last seen | Trusted Remote-* headers | Attribute playlists and credential management | Art. 6(1)(f) | Operator, SQLite | Germany | Until user/operator deletion or request; no automatic content expiry | apps/server/src/auth/actor.ts; services/user-service.ts; db/schema.ts |
| Playlists, prompts/steers, generation parameters, songs/metadata/lyrics, ratings, persona, cover uploads, audio, service/model settings and OAuth credentials | Application and user input | Music generation, library and playback, preference adaptation | Art. 6(1)(f) | Operator; OpenAI text inputs separately below | Own German SQLite, Longhorn volume, NAS and restricted credential files | Until user/operator deletion or request to datenschutz-infinitune@heerlab.com; backups ≤3 months | db/schema.ts; services/playlist-service.ts; services/song-service.ts; external/pi-credential-store.ts; live production evidence above |
| Device IDs/names, room roles, playback positions | Browser playback rooms | Requested playback and control | Art. 6(1)(f); necessary session storage | Operator and room users | Germany | Room state in process memory; browser tab session | apps/server/src/room/room-manager.ts; apps/web/src/hooks/useRoomConnection.ts |
| Request ID/method/path/status/duration/size, song/playlist IDs, titles/artists, device names, errors and possible supplied content; peer IP in proxy warnings | Pino, worker/security diagnostics | Debugging and security | Art. 6(1)(f) | Operator; scrubbed error events also GlitchTip | Germany | Application log entries expire 14 days after writing. The active file is filtered by each entry's top-level numeric Pino time at startup and every trim interval, default 15 seconds, and capped at the last 10,000 retained lines. Malformed or untimestamped lines use file mtime as the fallback. Inactive server session files expire after 14 days without writes. Kubernetes container logs are short-lived; no exact age is asserted | apps/server/src/logger.ts and logger.test.ts; index.ts; middleware/rate-limit.ts |
| Attacker IP, incident time/type; local alerts/decisions | CrowdSec analyses proxy logs | Attack prevention | Art. 6(1)(f) | Operator; CrowdSec SAS, 20 rue Maurice Arnoux, 92120 Montrouge, France; network partners/members | France/international; CrowdSec states SCCs | Local flush 7 days / 5,000 alerts, active-decision exception; local profiles 4h, imports vary; attached expired decisions can remain until alert pruning. Central full IP generally ≤3 months, some analyses/training ≤1 year | [CrowdSec privacy](https://www.crowdsec.net/privacy-policy); shared pangolin-access-retention-implementation-report.md § E and report-2.md; [v1.8.1 flush source](https://github.com/crowdsecurity/crowdsec/blob/v1.8.1/pkg/database/flush.go) |
| Music prompts/steers, musical constraints, generated metadata/lyrics, rating-derived persona extracts and liked/disliked song information; no app-added user name/email | Pi openai-codex text and persona calls | Generate requested music | Art. 6(1)(f) | OpenAI Ireland Limited, 1st Floor, The Liffey Trust Centre, 117-126 Sheriff Street Upper, Dublin 1, D01 YC43, Ireland; own controller for consumer account | USA and other countries; OpenAI states adequacy decisions or SCCs under Art. 46(2)(c) | OpenAI's own purpose/account/legal retention rules; no uniform period established. Policy permits service improvement/model training with opt-out; account opt-out unverified | external/llm.ts; external/pi-runtime.ts; production config above; [EU privacy policy](https://openai.com/policies/eu-privacy-policy/), served [German version](https://openai.com/de-DE/policies/eu-privacy-policy/), verified in real browser by orchestrator on 2026-10-21, §12 and transfers/training text |
| Music/vocal captions, full lyrics, tempo/key/meter/language/duration and sampler/model parameters; Ollama model-list/test requests | ACE-Step and Ollama LAN endpoints | Audio synthesis and technical diagnostics | Art. 6(1)(f) | Operator | Own infrastructure in Germany, no external recipient | Output/content deletion as above; no separate external-provider retention claim | external/ace.ts; external/service-urls.ts; routes/autoplayer.ts; verified endpoints above |
| Sanitized paths, screen/language, performance, playback/playlist/settings events; pipeline IDs/provider/model/stage/duration/status; outbound hostname | Browser tracker and server event bus | Usage/reliability analysis | Art. 6(1)(f) | Operator's Umami at umami.heerlab.com | Own infrastructure in Germany | Currently no fixed deletion period | apps/web/src/lib/telemetry/browser.ts; e2e/fixtures/umami-script.js; apps/server/src/telemetry/umami.ts; packages/shared/src/telemetry.ts; read-only checks above |
| Errors/stacks, scrubbed URLs/breadcrumbs, release/environment, 10%-sampled traces and pipeline tags; receiving host sees IP/user agent | Sentry browser/frontend/backend SDKs | Debugging and operational security | Art. 6(1)(f) | Operator's GlitchTip, not Sentry SaaS | Own infrastructure in Germany | Errors/transactions 90 days, raw spans 30 days; backups as below | Shared telemetry scrubber; orchestrator/round-2 live retention verification; [installation documentation](https://glitchtip.com/documentation/install/), [v6.2.6 settings](https://gitlab.com/glitchtip/glitchtip-backend/-/raw/v6.2.6/glitchtip/settings.py) |
| Email address, message and technical mail metadata | Contact email | Answer requests | Art. 6(1)(f) | Operator; Fastmail Pty Ltd, PO Box 234, Collins Street West, VIC 8007, Australia, processor | Australia/USA/India and other listed locations; SCCs Art. 46(2)(c) | Operator deletes after handling unless retention needed; Fastmail backup/log deletion under published rules | Shared template; [privacy](https://www.fastmail.com/policies/privacy/), [DPA](https://www.fastmail.com/policies/dpa/), [SCCs](https://www.fastmail.com/policies/dpa/section3/) |
| Backup copies of application personal data | Longhorn PVC infinitune in media namespace | Recovery | Art. 6(1)(f) | Operator | Own infrastructure in Germany | Overwritten after at most 3 months | Orchestrator verified PVC recurring-job group default: daily backup retain 7, weekly 2, monthly 3, daily snapshot 7; shared facts also specify Velero 7/14/90 days and CNPG snapshots 7 days |

## Browser storage and telemetry access

| Entry | Purpose / duration | Evidence / status |
| --- | --- | --- |
| Pangolin cookie p_session_token_s.<timestamp> | Resource-domain access, HttpOnly, Secure, SameSite=Lax, 720 hours / 30 days | Live session_cookie_name p_session_token, no resource_session_length_hours override; Pangolin source constructs the resource suffix; technically necessary |
| localStorage infinitune-player | Requested volume/mute preference, until cleared | apps/web/src/lib/player-store.ts |
| sessionStorage infinitune-device-id | Playback-room device, tab session | apps/web/src/hooks/useRoomConnection.ts |
| sessionStorage infinitune-radio-listener-id | Radio listener/reconnect, tab session | apps/web/src/lib/radio-socket.ts |
| sessionStorage tsr-scroll-restoration-v1_3 | Navigation scroll restoration, tab session | TanStack Router; production-browser storage test |
| localStorage umami.disabled | Read only if already present to honor opt-out, until cleared | Inspected tracker fixture; app never creates it |
| Umami/Sentry memory | Session/cache state; no additional cookies, localStorage/sessionStorage identifiers or IndexedDB | Tracker reads screen, browser language, document title/referrer, current URL and performance/navigation data; wrapper replaces title, removes referrer/query/hash/share token before sending. Sentry session tracking/replay disabled |
| localStorage infinitune-shoo-id-token | Optional alternate-login token until cleared | Present in code, not used in production; omitted from published storage table |

No app IndexedDB use was found. Legal pages contain no scripts or telemetry and set no cookies. Source review and prior production-build local storage tests support the application list; an authenticated live browser session remains outside this child's verification.

## Integrations omitted from the published policy

| Integration | Production status and evidence | Code source |
| --- | --- | --- |
| YouTube / SoundCloud / Bandcamp reference downloads | Present in code, not used in production: zero songs with source_url, zero agent runs | external/youtube-audio.ts |
| LRCLIB | Present in code, not used in production: no source songs/cover tasks in supplied DB evidence | external/lrclib.ts; worker/song-worker.ts |
| DuckDuckGo / Wikipedia / arbitrary agent web research | Present in code, not used in production: zero agent runs/messages/memory | agents/tools/web-tools.ts |
| OpenRouter | Present in code, not used in production: text/persona provider openai-codex, empty OpenRouter key, Pi credential store only openai-codex | external/llm-client.ts; external/pi-runtime.ts |
| Inference.sh | Present in code, not used in production: legacy comfyui selection normalizes to inference-sh but no credentials/config; last cover 2026-03-06 | external/cover.ts; external/inference-sh.ts |
| Codex imagegen | Present in code, not used in production: no dedicated enablement/credentials in verified production configuration | external/codex-imagegen.ts |
| Shoo | Present in code, not used in production: not configured, Pangolin SSO used | auth/shoo.ts; apps/web/src/integrations/api/client.ts |
| Resend | Configured globally, not used for Infinitune: GlitchTip project 7 has zero alert rules, recipients and notifications. No Infinitune data goes to Resend; no app mail transport | Round-2 read-only project-7 inspection and GlitchTip global SMTP manifest |
| Umami recorder / replay / heatmaps | Removed startup path in this candidate. No recording-policy request, recorder script or recording transport is started, regardless of server policy | apps/web/src/lib/telemetry/browser.ts and browser.test.ts; e2e/telemetry.spec.ts |

The published DE/EN pages say that further optional integrations are not in use and the policy will be updated before activation. Absence of historical rows alone is not a technical prohibition on future optional features; the operator must maintain that scope.

## Decisions implemented and remaining open items

1. Active-file trimming removes entries whose top-level numeric Pino `time` is at least 14 days old, then retains at most the last 10,000 lines. Malformed JSON and lines without a finite numeric top-level `time` are retained only while the file's mtime is less than 14 days old. Files are rewritten only when entries are removed. Cleanup runs at startup and periodically, every 15 seconds by default. Inactive server session files retain the 14-day inactivity cutoff; only regular files matching the server's per-start filename are removed, preserving unrelated files, symlinks and directories.
2. OpenAI is a separate recipient and its own controller for the consumer login. Policy describes submitted content, possible training and stated transfer mechanisms without claiming an account setting, API DPA or a fixed provider retention period.
3. Unused integrations and Shoo storage omitted from published pages; production evidence remains above.
4. Analytics/error tracking use the decided Art. 6(1)(f) basis. Recorder startup removed; Umami storage access and lack of fixed analytics retention disclosed. GlitchTip retention stated from verified values.
5. Proxy/app/local-security logs documented separately. Shared Traefik 14-day template wording retained as instructed; actual delivery readiness remains with the orchestrator.

Open items for the user/operator:

- Training opt-out status of the operator's ChatGPT account: unverified.
- No automatic content expiry: known, accepted gap. Deletion is by user/operator action or request to datenschutz-infinitune@heerlab.com, with backups overwritten within three months. Deleting a database row alone does not prove all media copies are erased; operator handling must include remaining files.
- Umami analytics data currently have no fixed deletion period: disclosed, still an operational retention gap.
- CrowdSec's separate Art. 26 agreement document has not been verified. Pages accurately attribute the joint-controller description to CrowdSec, without claiming a verified agreement.
- No exact maximum age has been verified for Kubernetes container logs. Pages describe them as short-lived, without inventing a duration.
- OpenAI does not have a uniform fixed retention period established for this account; published policy refers to OpenAI's own rules.
- Orchestrator delivery work: re-read shared readiness and confirm completed Traefik/Pangolin retention, live contact form and exact four-path Pangolin bypass; verify anonymous live pages and authenticated storage. No infrastructure edits, push, PR, tag or deployment are authorized in this implementation task.

## Serving and verification handoff

`apps/web/src/server.ts` serves exactly /impressum, /datenschutz, /legal-notice and /privacy through `getLegalResponse` before app rendering or request spans. Each is self-contained HTML with inline CSS, no scripts/API/fonts/external assets, noindex metadata/header and restrictive CSP. nginx already routes them to the frontend. The shared legal footer remains in the root document shell; the embedded mini player is excluded.

Unit coverage checks all four rendered pages for operator details, per-site addresses, the slugged contact URL, no draft markers/unresolved placeholders, no excluded backup provider, matched language sections and no unused recipients. Production-build browser tests cover home/footer navigation and standalone JavaScript-disabled pages at 1280px and 390px. Provider/telemetry calls are mocked or blocked.

Round-3 final candidate checks:

- `pnpm check`: passed, 348 files.
- `pnpm typecheck`: passed across the workspace.
- `pnpm --filter @infinitune/web test`: passed, 23 files / 180 tests.
- `pnpm --filter @infinitune/server exec vitest run src/logger.test.ts src/telemetry/umami.test.ts`: passed, 2 files / 5 tests, including expiry boundaries, unrelated-file/symlink preservation and active-destination handling.
- `pnpm build`: passed. Existing TanStack inputValidator deprecation and dependency build warnings remain unrelated to this change.
- `pnpm --filter @infinitune/web exec playwright test legal.spec.ts telemetry.spec.ts`: passed, 6 tests against the production build. Legal flows at 1280px and 390px; all four pages also work with JavaScript disabled. Enabled analytics sends no recorder/policy/recording requests despite a recording-enabled server fixture. External requests are mocked or blocked, including SSR transports.
- T3 collaborative preview: inspected the built privacy page at desktop and 390px, including the storage table; mobile scroll width equalled viewport width and the page contained zero scripts.
- Uniform German SSO wording verified verbatim; rendered-page tests reject unresolved placeholders, draft markers and the excluded backup provider. Generated route-tree churn restored. `git diff --check` passed.

No live AI provider calls, infrastructure edits, remote Git writes or deployment were performed. Local production-preview server and tab were closed after verification.
