# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Infinitune is an AI-powered infinite music generator. Users describe a vibe via prompt, and a background worker orchestrates a pipeline (LLM → ComfyUI → ACE-Step) to generate songs with metadata, lyrics, cover art, and audio in real-time. The browser displays songs as they're generated via Convex real-time subscriptions.

## Commands

```bash
# Development (all three needed simultaneously)
pnpm dev              # Vite dev server on :3000
npx convex dev        # Convex backend (real-time DB)
pnpm worker           # Background song generation worker

# Quality
pnpm check            # Biome lint + format
pnpm test             # Vitest (jsdom, run mode)
npx tsc --noEmit      # Type check

# UI components
pnpm dlx shadcn@latest add <component>
```

Pre-commit hooks (lefthook): gitleaks, biome-check, typecheck.

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

### Song Generation Pipeline

Each song flows through statuses: `pending` → `generating_metadata` → `metadata_ready` → `submitting_to_ace` → `generating_audio` → `saving` → `ready` → `played`. Error states: `error`, `retry_pending`.

The worker spawns a `SongWorker` per song. Endpoint queues manage concurrency with priority (interrupts > epoch songs > filler).

### Queue Priority (pick-next-song.ts)

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

### API Routes

Server-side API endpoints live at `src/routes/api.autoplayer.*.ts`. These are POST handlers (TanStack Start + Nitro) that call services (LLM, ACE-Step, ComfyUI) and return JSON.

## Convex Schema (Key Tables)

- **playlists**: prompt, llmProvider/Model, mode (endless/oneshot), status (active/closing/closed), promptEpoch, steerHistory, generation params
- **songs**: playlistId (FK), orderIndex, status, all metadata fields, audioUrl, coverUrl, aceTaskId, isInterrupt, userRating, personaExtract, timing metrics
- **settings**: key/value store for service URLs and model config

Convex auto-generates types in `convex/_generated/` — never edit those files. `routeTree.gen.ts` is also auto-generated.

## Code Style

- **Formatter**: Biome — tabs, double quotes, organized imports
- **Path alias**: `@/` → `src/` (e.g., `@/components/ui/button`, `@/hooks/useAutoplayer`)
- **Convex imports**: `import { api } from "../../convex/_generated/api"` (not aliased)
- **UI components**: shadcn/radix in `src/components/ui/`
- **Route files**: `autoplayer.tsx` is the main player; `autoplayer_.*.tsx` are nested routes (underscore = layout escape)

## File Locations

- Song generation logic: `worker/song-worker.ts`
- Worker orchestrator: `worker/index.ts`
- LLM prompts & schemas: `src/services/llm.ts`
- Player state: `src/lib/player-store.ts`
- Queue selection: `src/lib/pick-next-song.ts`
- Convex schema: `convex/schema.ts`
- Song mutations: `convex/songs.ts`
- ComfyUI workflows: `src/data/comfyui-workflow-*.json`
