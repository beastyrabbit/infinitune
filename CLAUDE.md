# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Infinitune is an AI-powered infinite music generator. Users describe a vibe via prompt, and a background worker orchestrates a pipeline (LLM → ComfyUI → ACE-Step) to generate songs with metadata, lyrics, cover art, and audio in real-time. The browser displays songs as they're generated via Convex real-time subscriptions.

## Commands

```bash
# Development (all needed simultaneously)
pnpm dev:all          # All four processes at once (recommended)
pnpm dev              # Vite dev server on :5173
npx convex dev        # Convex backend (real-time DB)
pnpm worker           # Background song generation worker
pnpm room-server      # Room server on :5174 (multi-device playback)

# Quality
pnpm check            # Biome lint + format
pnpm test             # Vitest (jsdom, run mode)
npx tsc --noEmit      # Type check

# UI components
pnpm dlx shadcn@latest add <component>
```

Pre-commit hooks (lefthook): gitleaks, biome-check, typecheck. Note: codebase has some pre-existing Biome warnings (e.g., `noExplicitAny` in worker/) — these are known and not blockers.

**Testing gap:** Room server (`room-server/`) has no test coverage. Priority targets: `pick-next-song.ts`, `room.ts` (state machine), `protocol.ts` (schema validation).

## Architecture

```
Browser (React 19 + TanStack Router)
  ↕ real-time WebSocket subscriptions
Convex (database + mutations/queries)
  ↕ HTTP polling (~2s)
Worker (Node.js, tsx watch)
  ├── LLM (Ollama/OpenRouter) → metadata + lyrics
  ├── ComfyUI → cover art
  └── ACE-Step 1.5 → audio synthesis
  ↕ NFS
Audio files served from local storage
```

**Browser ↔ Convex**: Real-time push via `useQuery()` WebSocket subscriptions. No polling.
**Worker → Convex**: HTTP client polls for pending songs, writes results back via mutations.
**Room Server ↔ Convex**: HTTP client polls song queues per room (~2s). Marks songs as played via mutations.
**Browser ↔ Room Server**: WebSocket for real-time playback coordination across devices.

### Room Server (Multi-Device Playback)

Standalone Node.js process on `:5174` that coordinates playback across multiple devices (like Sonos/Spotify Connect). Devices join a **room** as either **player** (outputs audio) or **controller** (remote control, no audio). All players in a room play the same song with synchronized start times. Any device can send commands (play/pause/skip/seek/volume).

WebSocket protocol: Zod-validated messages in `room-server/protocol.ts`. REST API: `GET /api/v1/rooms`, `POST /api/v1/rooms`, `GET /api/v1/now-playing?room={id}` (Waybar compatible), `GET /api/v1/openapi.json`.

The worker is **completely untouched** — it keeps generating songs into Convex. The room server reads from Convex and pushes updates to connected devices.

### Song Generation Pipeline

Each song flows through statuses: `pending` → `generating_metadata` → `metadata_ready` → `submitting_to_ace` → `generating_audio` → `saving` → `ready` → `played`. Error states: `error`, `retry_pending`.

The worker spawns a `SongWorker` per song. Endpoint queues manage concurrency with priority (interrupts > epoch songs > filler).

### Queue Priority (pick-next-song.ts)

**WARNING:** `pick-next-song.ts` exists in BOTH `src/lib/` and `room-server/` with identical logic. Changes to queue priority must be applied to both files.

1. **Interrupts** (user-requested songs) — FIFO by creation time
2. **Current-epoch songs** — next by orderIndex after current position
3. **Filler** — any remaining ready song by orderIndex

### Playlist Epochs & Steering

Users can "steer" a playlist mid-stream by changing the prompt. This bumps `promptEpoch`. New songs generate under the new epoch. The UI shows an "up next" transition banner until a new-epoch song starts playing. `transitionDismissed` tracks whether the user acknowledged the switch.

## Key Patterns

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

### Hook Composition (useAutoplayer)

The main hook orchestrates several sub-hooks:
- `useAudioPlayer` — HTML5 Audio lifecycle
- `useAutoplay` — auto-advance when song ready
- `usePlaybackTracking` — send currentTime to Convex
- `usePlaylistLifecycle` — close playlist when done
- `usePlaylistHeartbeat` — keep-alive signal

### LLM Client (llm-client.ts)

All LLM calls go through `src/services/llm-client.ts` — a gateway using Vercel AI SDK (`ai` package) with per-provider semaphores (ollama:1, openrouter:5). Three exports: `callLlmText()` for plain text, `callLlmObject<T>()` for Zod-validated structured output, `callImageGen()` for images. Provider factory handles Ollama (`ollama-ai-provider-v2`) and OpenRouter (`@openrouter/ai-sdk-provider` with `response-healing` plugin).

### API Routes

Server-side API endpoints live at `src/routes/api.autoplayer.*.ts`. These are POST handlers (TanStack Start + Nitro) that call services (LLM, ACE-Step, ComfyUI) and return JSON.

## Convex Schema (Key Tables)

- **playlists**: prompt, llmProvider/Model, mode (endless/oneshot), status (active/closing/closed), promptEpoch, steerHistory, generation params
- **songs**: playlistId (FK), orderIndex, status, all metadata fields, audioUrl, coverUrl, aceTaskId, isInterrupt, userRating, personaExtract, timing metrics
- **settings**: key/value store for service URLs and model config

Convex auto-generates types in `convex/_generated/` — never edit those files. `routeTree.gen.ts` is also auto-generated.

## Commit Discipline

Commit regularly after editing files. Don't batch up large sets of changes — make small, focused commits as you go. Pushing is not required immediately, but frequent commits keep work safe and history clean.

## Code Style

- **Formatter**: Biome — tabs, double quotes, organized imports
- **Path alias**: `@/` → `src/` (e.g., `@/components/ui/button`, `@/hooks/useAutoplayer`)
- **Convex imports**: `import { api } from "../../convex/_generated/api"` (not aliased)
- **UI components**: shadcn/radix in `src/components/ui/`
- **Zod imports**: `import z from "zod"` (default import — Zod 4, not `{ z }`)
- **Route files**: `autoplayer.tsx` is the main player; `autoplayer_.*.tsx` are nested routes (underscore = layout escape)

## File Locations

- Song generation logic: `worker/song-worker.ts`
- Worker orchestrator: `worker/index.ts`
- LLM prompts & schemas: `src/services/llm.ts`
- Player state: `src/lib/player-store.ts`
- Queue selection: `src/lib/pick-next-song.ts`
- Convex schema: `convex/schema.ts`
- Song mutations: `convex/songs.ts`
- LLM client gateway: `src/services/llm-client.ts` (Vercel AI SDK + per-provider semaphore)
- ComfyUI workflows: `src/data/comfyui-workflow-*.json`
- Room server entry: `room-server/index.ts`
- Room server protocol (Zod schemas): `room-server/protocol.ts`
- Room state management: `room-server/room.ts`
- Room manager: `room-server/room-manager.ts`
- Room↔Convex sync: `room-server/convex-sync.ts`
- Room connection hook: `src/hooks/useRoomConnection.ts`
- Room player hook: `src/hooks/useRoomPlayer.ts`
- Room controller hook: `src/hooks/useRoomController.ts`
- Mini player: `src/components/mini-player/MiniPlayer.tsx`
- Mini player route: `src/routes/autoplayer_.mini.tsx`
- Room selection page: `src/routes/rooms.tsx`
- Device control panel: `src/components/autoplayer/DeviceControlPanel.tsx`
