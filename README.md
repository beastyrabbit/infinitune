<div align="center">

<br>

# INFINITUNE

### Infinite Generative Music

**Describe a vibe. Get an endless stream of original AI-generated songs — lyrics, cover art, and audio, all created on the fly.**

<br>

[How It Works](#how-it-works) · [Multi-Device Playback](#multi-device-playback) · [Tech Stack](#tech-stack) · [Quick Start](#quick-start) · [Architecture](#architecture)

<br>

</div>

## How It Works

> **1.** Describe your music — *"2010 techno beats with English lyrics, S3RL energy, heavy 808 bass"*
>
> **2.** Hit Start — a background worker kicks off the pipeline: LLM writes metadata + lyrics, ComfyUI renders cover art, ACE-Step synthesizes audio
>
> **3.** Listen endlessly — songs appear in real-time. Rate them up/down to steer the direction. Request one-offs or generate entire albums from a single track.

## Multi-Device Playback

Infinitune includes a **Room Server** for synchronized multi-device playback — think Sonos or Spotify Connect, but for AI-generated music.

> **1.** Go to **[ROOMS]** and create a room linked to any active playlist
>
> **2.** Open the room on multiple devices — each joins as a **player** (outputs audio) or **controller** (remote control only)
>
> **3.** All players in a room stay in sync — same song, same position. Controllers see real-time playback state and can play/pause, skip, seek, or adjust volume across all devices at once.

**Per-device control:** Adjust volume or pause individual players independently. Devices in "individual" mode ignore room-wide changes until explicitly synced back. Rename devices for easy identification (e.g. "Kitchen Speaker", "Office").

**Gapless playback:** The next song is preloaded in the background while the current one plays — no gaps between tracks.

**Clock sync:** Devices calibrate against the server clock on connect (NTP-style ping/pong), so synchronized play commands land within ~50ms across the LAN.

## Hardware Setup

Infinitune runs on a **Framework Desktop** (AMD Ryzen / dedicated GPU) hosting all AI services locally on the same network:

| Service | Role | Details |
|:--------|:-----|:--------|
| **ACE-Step 1.5** | Audio | Text-to-music model — generates full songs from lyrics + captions |
| **Ollama** | Local LLM | Llama 3.1, DeepSeek, etc. for song metadata, lyrics, persona extraction |
| **OpenRouter** | Cloud LLM | Optional — access DeepSeek, Claude, GPT via API |
| **ComfyUI** | Cover Art | Generates vinyl-style album covers from image prompts |

## Tech Stack

| | Technology |
|:--|:-----------|
| **Frontend** | React 19 · TanStack Router · React Query · Tailwind CSS 4 |
| **Backend** | Hono (unified server — API + worker + rooms on one port) |
| **Database** | SQLite (better-sqlite3, WAL mode) · Drizzle ORM |
| **Room Server** | Integrated WebSocket server · multi-device sync · REST API |
| **Worker** | Event-driven background pipeline · per-song workers · concurrency queues |
| **Audio** | ACE-Step 1.5 (text-to-music synthesis) |
| **Cover Art** | ComfyUI (image generation) |
| **LLM** | Vercel AI SDK · Ollama (local) or OpenRouter (cloud) |
| **Build** | Vite 7 · TypeScript 5.7 · Biome (lint/format) · pnpm monorepo |

## Quick Start

```bash
# Install dependencies
pnpm install

# Start everything (web + unified server)
pnpm dev:all
```

> The web dev server runs on `:5173`, the unified backend on `:5175`. Create an `apps/web/.env.local` with `VITE_API_URL=http://localhost:5175` for local dev.

## Environment Variables

Configure in `apps/server/.env.local`:

| Variable | Default | Description |
|:---------|:--------|:------------|
| `OLLAMA_URL` | `http://192.168.10.120:11434` | Ollama API endpoint |
| `ACE_STEP_URL` | `http://192.168.10.120:8001` | ACE-Step audio generation endpoint |
| `COMFYUI_URL` | `http://192.168.10.120:8188` | ComfyUI image generation endpoint |
| `OPENROUTER_API_KEY` | — | OpenRouter API key *(if using cloud LLM)* |
| `MUSIC_STORAGE_PATH` | `/mnt/truenas/MediaBiB/media/AI-Music` | Path for storing generated audio files |

## Architecture

```
Browser (React 19 + TanStack Router + React Query)
  ↕ HTTP fetch + WebSocket event invalidation (/ws)
  ↕ WebSocket room protocol (/ws/room)
Unified Server (Hono on :5175)
  ├── SQLite (better-sqlite3, WAL mode)
  ├── In-memory typed event bus
  ├── Service layer (song, playlist, settings)
  ├── Event-driven worker (metadata → cover → audio pipeline)
  ├── Room manager (multi-device playback)
  ├── WebSocket bridge → Browser (event invalidation)
  └── External services:
      ├── LLM (Ollama/OpenRouter via Vercel AI SDK)
      ├── ComfyUI → cover art
      └── ACE-Step 1.5 → audio synthesis
```

**One server process** handles everything: API routes, worker pipeline, room management, event broadcasting. No message queues. No inter-process HTTP. Single port (5175).

**Event-driven:** Service mutations emit events → worker handlers react instantly → no polling. Song completion triggers buffer deficit check → creates new pending songs → triggers metadata generation → self-sustaining loop.

## Project Structure

```
infinitune/
  packages/
    shared/            # @infinitune/shared — types, protocol, pick-next-song
    room-client/       # @infinitune/room-client — room hooks
  apps/
    web/               # React frontend (Vite + TanStack)
    server/            # Unified backend (Hono — API + worker + rooms)
```

<div align="center">
<sub>Built with mass GPU cycles and human curiosity.</sub>
</div>
