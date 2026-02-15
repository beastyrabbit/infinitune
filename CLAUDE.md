# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Infinitune is an AI-powered infinite music generator. Users describe a vibe via prompt, and a background worker orchestrates a pipeline (LLM → ComfyUI → ACE-Step) to generate songs with metadata, lyrics, cover art, and audio in real-time. The browser displays songs as they're generated via React Query + WebSocket event invalidation.

## Commands

```bash
# Development
pnpm dev:all          # Web + server (2 processes, recommended)
pnpm dev              # Vite dev server on :5173
pnpm server           # Unified backend on :5175 (API + worker + rooms)

# Quality
pnpm check            # Biome lint + format
pnpm typecheck        # TypeScript across all packages (pnpm -r typecheck)
pnpm test             # Vitest across all packages

# UI components
pnpm dlx shadcn@latest add <component>
```

Pre-commit hooks (lefthook): gitleaks, biome-check, typecheck (`pnpm -r typecheck`). Note: codebase has some pre-existing Biome warnings — these are known and not blockers.

## Architecture

pnpm monorepo with workspace packages.

```
infinitune/
  packages/
    shared/            # @infinitune/shared — types, protocol, pick-next-song
    room-client/       # @infinitune/room-client — room hooks (future)
  apps/
    web/               # @infinitune/web — React frontend (Vite + TanStack)
    server/            # @infinitune/server — Unified backend (Hono)
```

```
Browser (React 19 + TanStack Router + React Query)
  ↕ HTTP fetch + WebSocket event invalidation (/ws)
  ↕ WebSocket room protocol (/ws/room)
Unified Server (Hono on :5175)
  ├── SQLite (better-sqlite3, WAL mode)
  ├── In-memory typed event bus (replaces RabbitMQ)
  ├── Service layer (song, playlist, settings)
  ├── Event-driven worker (metadata → cover → audio pipeline)
  ├── Room manager (multi-device playback)
  ├── WebSocket bridge → Browser (event invalidation)
  └── External services:
      ├── LLM (Ollama/OpenRouter via Vercel AI SDK)
      ├── ComfyUI → cover art
      └── ACE-Step 1.5 → audio synthesis
```

**One server process** handles everything: API routes, worker pipeline, room management, event broadcasting. No RabbitMQ. No inter-process HTTP. Single port (5175).

**Event-driven**: Service mutations emit events → worker handlers react instantly → no polling tick. Self-sustaining generation loop: song completion triggers buffer deficit check → creates new pending songs → triggers metadata generation → ...

### Song Generation Pipeline

Each song flows through statuses: `pending` → `generating_metadata` → `metadata_ready` → `submitting_to_ace` → `generating_audio` → `saving` → `ready` → `played`. Error states: `error`, `retry_pending`.

The worker spawns a `SongWorker` per song. Concurrency queues manage throughput with priority (interrupts > epoch songs > filler).

### Room Server (Multi-Device Playback)

Integrated into the unified server. Devices join a **room** as either **player** (outputs audio) or **controller** (remote control, no audio). All players sync playback. WebSocket protocol: Zod-validated messages in `packages/shared/src/protocol.ts`. REST API: `GET /api/v1/rooms`, `POST /api/v1/rooms`, `GET /api/v1/now-playing?room={id}`.

### Queue Priority (pick-next-song.ts)

Shared implementation in `packages/shared/src/pick-next-song.ts` (generic `PickableSong` interface).

1. **Interrupts** (user-requested songs) — FIFO by creation time
2. **Current-epoch songs** — next by orderIndex after current position
3. **Filler** — any remaining ready song by orderIndex

### Playlist Epochs & Steering

Users can "steer" a playlist mid-stream by changing the prompt. This bumps `promptEpoch`. New songs generate under the new epoch. The UI shows an "up next" transition banner until a new-epoch song starts playing. `transitionDismissed` tracks whether the user acknowledged the switch.

## Key Patterns

### Event Bus (apps/server/src/events/event-bus.ts)

Typed in-memory pub/sub. Handlers run in isolated microtasks (one throw doesn't kill others). Fire-and-forget emit. Events: `song.created`, `song.status_changed`, `song.deleted`, `song.metadata_updated`, `song.reordered`, `playlist.created`, `playlist.steered`, `playlist.status_changed`, `playlist.updated`, `playlist.deleted`, `playlist.heartbeat`, `settings.changed`.

### Service Layer (apps/server/src/services/)

Business logic lives in service functions (DB mutation + event emission). Routes are thin (validate → call service). Worker event handlers call services directly — no HTTP round-trips.

### Global Audio Element (player-store.ts)

A singleton `<audio>` element and TanStack Store (`playerStore`) persist across route changes. This prevents audio cuts on navigation. Mutations: `setPlaying()`, `setCurrentSong()`, `stopPlayback()`, `toggleMute()`.

### Dual State/Ref Pattern (useAutoplayer.ts)

```typescript
const [value, setValue] = useState(false);
const valueRef = useRef(false);
// State drives re-renders; ref provides stable value for callbacks
// Callbacks read ref to avoid stale closures from useEffect deps
```

Used for `transitionDismissed`, `userPaused`, `userHasInteracted`.

### LLM Client (apps/server/src/external/llm-client.ts)

Gateway using Vercel AI SDK (`ai` package) with per-provider semaphores (ollama:1, openrouter:5). Three exports: `callLlmText()` for plain text, `callLlmObject<T>()` for Zod-validated structured output, `callImageGen()` for images. Provider factory handles Ollama (`ollama-ai-provider-v2`) and OpenRouter (`@openrouter/ai-sdk-provider`).

## Database Schema (SQLite)

- **playlists**: prompt, llmProvider/Model, mode (endless/oneshot), status (active/closing/closed), promptEpoch, steerHistory (JSON text), generation params
- **songs**: playlistId (FK with cascade delete), orderIndex, status, all metadata fields, audioUrl, coverUrl, aceTaskId, isInterrupt, userRating, personaExtract, timing metrics
- **settings**: key/value store for service URLs and model config

Schema in `apps/server/src/db/schema.ts` (Drizzle ORM). Auto-created on startup via `ensureSchema()`. IDs are cuid2 strings. Wire format includes `_id` and `_creationTime` mapped from `id`/`createdAt` for backward compatibility.

### Drizzle Patterns

- **Upsert**: Use `db.insert().values().onConflictDoUpdate({ target, set })` — not select-then-insert
- **Batch status updates**: Use `db.update().set().where(and(eq(...), inArray(...)))` — not per-row loops
- **JSON text columns**: Always use `parseJsonField()` from `apps/server/src/wire.ts` — never raw `JSON.parse`
- **Heartbeat reactivation**: Only reactivates `closing` playlists (not `closed` — that's an explicit user action)

## Ports

Vite dev server on 5173, unified server on 5175 (registered in `/home/beasty/projects/.ports`).

## Commit Discipline

Commit regularly after editing files. Don't batch up large sets of changes — make small, focused commits as you go. Pushing is not required immediately, but frequent commits keep work safe and history clean.

## Code Style

- **Formatter**: Biome — tabs, double quotes, organized imports
- **Path alias**: `@/` → `apps/web/src/` (e.g., `@/components/ui/button`, `@/hooks/useAutoplayer`)
- **Type imports**: `import type { Song, Playlist } from "@infinitune/shared/types"` or `from "@/types"`
- **UI components**: shadcn/radix in `apps/web/src/components/ui/`
- **Zod imports**: `import z from "zod"` (default import — Zod 4, not `{ z }`)
- **Drizzle imports**: Import operators individually: `import { eq, and, or, inArray, isNotNull, desc, sql } from "drizzle-orm"`
- **Route files**: `autoplayer.tsx` is the main player; `autoplayer_.*.tsx` are nested routes (underscore = layout escape)

## File Locations

### Shared Packages
- Shared types: `packages/shared/src/types.ts`
- Room protocol (Zod schemas): `packages/shared/src/protocol.ts`
- Queue selection: `packages/shared/src/pick-next-song.ts`

### Server (apps/server/src/)
- Entry point: `index.ts`
- Database schema: `db/schema.ts`
- Database init: `db/migrate.ts`
- Event bus: `events/event-bus.ts`
- WS bridge: `events/ws-bridge.ts`
- Service layer: `services/song-service.ts`, `services/playlist-service.ts`, `services/settings-service.ts`
- API routes: `routes/songs/`, `routes/playlists.ts`, `routes/settings.ts`, `routes/rooms.ts`
- Worker: `worker/index.ts`, `worker/song-worker.ts`, `worker/queues.ts`
- Room: `room/room-manager.ts`, `room/room.ts`, `room/room-event-handler.ts`, `room/room-ws-handler.ts`
- External services: `external/llm-client.ts`, `external/llm.ts`, `external/ace.ts`, `external/cover.ts`
- Wire mappers: `wire.ts`

### Frontend (apps/web/src/)
- React Query hooks: `integrations/api/hooks.ts`
- API provider + WS: `integrations/api/provider.tsx`
- Player state: `lib/player-store.ts`
- Room hooks: `hooks/useRoomConnection.ts`, `hooks/useRoomPlayer.ts`, `hooks/useRoomController.ts`
- Mini player: `components/mini-player/MiniPlayer.tsx`
- LLM prompts: `services/llm.ts`

### Legacy (still present, to be removed)
- `api-server/` — old standalone API server
- `worker/` — old standalone worker
- `room-server/` — old standalone room server
