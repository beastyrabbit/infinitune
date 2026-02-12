<div align="center">

<br>

# ∞ INFINITUNE

### Infinite Generative Music

**Describe a vibe. Get an endless stream of original AI-generated songs — lyrics, cover art, and audio, all created on the fly.**

<br>

![Player Overview](public/screenshots/player-overview.png)

<br>

[How It Works](#how-it-works) · [Tech Stack](#tech-stack) · [Quick Start](#quick-start) · [Architecture](#architecture)

<br>

</div>

## Screenshots

<table>
<tr>
<td width="50%">

**Playlist Creator** — describe your music, pick an LLM, hit start

![Playlist Creator](public/screenshots/playlist-creator.png)

</td>
<td width="50%">

**Queue Grid** — vinyl covers generated per-song by ComfyUI

![Queue Grid](public/screenshots/queue-grid.png)

</td>
</tr>
</table>

## How It Works

> **1.** Describe your music — *"2010 techno beats with English lyrics, S3RL energy, heavy 808 bass"*
>
> **2.** Hit Start — a background worker kicks off the pipeline: LLM writes metadata + lyrics → ComfyUI renders cover art → ACE-Step synthesizes audio
>
> **3.** Listen endlessly — songs appear in real-time. Rate them 👍/👎 to steer the direction. Request one-offs or generate entire albums from a single track.

## Hardware Setup

Infinitune runs on a **Framework Desktop** (AMD Ryzen / dedicated GPU) hosting all AI services locally on the same network:

| Service | Role | Details |
|:--------|:-----|:--------|
| **ACE-Step 1.5** | 🎵 Audio | Text-to-music model — generates full songs from lyrics + captions |
| **Ollama** | 🧠 Local LLM | Llama 3.1, DeepSeek, etc. for song metadata, lyrics, persona extraction |
| **OpenRouter** | ☁️ Cloud LLM | Optional — access DeepSeek, Claude, GPT via API |
| **ComfyUI** | 🎨 Cover Art | Generates vinyl-style album covers from image prompts |
| **Convex** | ⚡ Real-time DB | Syncs playlist state between browser, worker, and all clients |

## Tech Stack

| | Technology |
|:--|:-----------|
| **Frontend** | React 19 · TanStack Router · Tailwind CSS 4 |
| **Backend** | Convex (real-time database + mutations/queries) |
| **Worker** | Node.js background process · per-song workers · endpoint queues |
| **Audio** | ACE-Step 1.5 (text-to-music synthesis) |
| **Cover Art** | ComfyUI (image generation) |
| **LLM** | Ollama (local) or OpenRouter (cloud) |
| **Build** | Vite 7 · TypeScript 5.7 · Biome (lint/format) |

## Quick Start

```bash
# Install dependencies
pnpm install

# Start Convex backend
npx convex dev

# Start dev server
pnpm dev

# Start the generation worker
pnpm worker
```

> All three processes need to run simultaneously. Configure service URLs in Settings (`/autoplayer/settings`) or via environment variables.

## Environment Variables

Configure in `.env.local`:

| Variable | Default | Description |
|:---------|:--------|:------------|
| `VITE_CONVEX_URL` | — | Convex deployment URL *(required)* |
| `OLLAMA_URL` | `http://192.168.10.120:11434` | Ollama API endpoint |
| `ACE_STEP_URL` | `http://192.168.10.120:8001` | ACE-Step audio generation endpoint |
| `COMFYUI_URL` | `http://192.168.10.120:8188` | ComfyUI image generation endpoint |
| `OPENROUTER_API_KEY` | — | OpenRouter API key *(if using cloud LLM)* |
| `MUSIC_STORAGE_PATH` | `/mnt/truenas/MediaBiB/media/AI-Music` | Path for storing generated audio files |
| `ACE_NAS_PREFIX` | — | NAS path prefix for ACE-Step output |

## Architecture

```
Browser (React + TanStack Router)
  ↕ real-time WebSocket sync
Convex (database + API)
  ↕ HTTP polling
Worker (Node.js)
  ├── LLM → song metadata + lyrics
  ├── ComfyUI → cover art
  └── ACE-Step → audio generation
```

The frontend creates playlists and displays songs in real-time. The worker polls Convex for pending songs, orchestrates the generation pipeline (LLM → cover art → audio), and writes results back. Convex's real-time subscriptions push updates to the browser instantly.

## Project Structure

```
src/
  routes/          # File-based routes + API endpoints
  components/      # React components (autoplayer/, ui/)
  services/        # LLM, ACE-Step, cover art integrations
  hooks/           # Custom React hooks
  lib/             # Utilities + player store
convex/            # Database schema, mutations, queries
worker/            # Background song generation worker
```

<div align="center">
<sub>Built with mass GPU cycles and human curiosity.</sub>
</div>
