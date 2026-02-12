# Autoplayer

AI-powered infinite music playlist generator. Describe a vibe, get an endless stream of original songs with lyrics, cover art, and audio — all generated on the fly.

## Tech Stack

- **Frontend:** React 19, TanStack Router (file-based), Tailwind CSS 4
- **Backend:** Convex (real-time database + mutations/queries)
- **Worker:** Node.js background process with per-song workers and endpoint queues
- **Audio Generation:** ACE-Step 1.5 (text-to-music)
- **Cover Art:** ComfyUI (image generation)
- **LLM:** Ollama (local) or OpenRouter (cloud) for song metadata + lyrics
- **Build:** Vite 7, TypeScript 5.7, Biome (lint/format)

## Prerequisites

- Node.js 20+
- pnpm
- [Convex](https://convex.dev) account
- ACE-Step server (audio generation)
- Ollama (local LLM) or OpenRouter API key
- Optional: ComfyUI (cover art generation)

## Quick Start

```bash
# Install dependencies
pnpm install

# Start Convex backend (separate terminal)
npx convex dev

# Start dev server (separate terminal)
pnpm dev

# Start worker (separate terminal)
pnpm worker
```

Configure service URLs in the Settings page (`/autoplayer/settings`) or via environment variables.

## Environment Variables

Configure these in `.env.local` or export them in your shell:

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_CONVEX_URL` | — | Convex deployment URL (required) |
| `OLLAMA_URL` | `http://192.168.10.120:11434` | Ollama API endpoint |
| `ACE_STEP_URL` | `http://192.168.10.120:8001` | ACE-Step audio generation endpoint |
| `COMFYUI_URL` | `http://192.168.10.120:8188` | ComfyUI image generation endpoint |
| `OPENROUTER_API_KEY` | — | OpenRouter API key (if using cloud LLM) |
| `MUSIC_STORAGE_PATH` | `/mnt/truenas/MediaBiB/media/AI-Music` | Path for storing generated audio files |
| `ACE_NAS_PREFIX` | — | NAS path prefix for ACE-Step output |

Most settings can also be configured via the Settings page (`/autoplayer/settings`).

## Architecture

```
Browser (React + TanStack Router)
  ↕ real-time sync
Convex (database + API)
  ↕ polling
Worker (background process)
  ├── LLM → song metadata + lyrics
  ├── ComfyUI → cover art
  └── ACE-Step → audio generation
```

The frontend creates playlists and displays songs in real-time. The worker polls Convex for pending songs, orchestrates the generation pipeline (LLM → cover art → audio), and writes results back. Convex's real-time subscriptions push updates to the browser instantly.

## Project Structure

```
src/
  routes/          # File-based routes + API endpoints
  components/      # React components
  services/        # LLM, ACE-Step, cover art integrations
  hooks/           # Custom React hooks
  lib/             # Utilities
convex/            # Database schema, mutations, queries
worker/            # Background song generation worker
```
