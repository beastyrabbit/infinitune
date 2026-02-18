# OpenClaw Prompt Analysis vs Infinitune

Date: 2026-02-18

## Scope

This analysis compares how OpenClaw builds prompts against Infinitune's music-generation prompting flow, then maps concrete changes implemented in this branch.

## OpenClaw Prompt Patterns (Text + Architecture)

### 1. Section-based prompt composition

OpenClaw builds prompts from named sections rather than one monolithic string:
- `.ref/openclaw/src/agents/system-prompt.ts`
  - `buildSkillsSection(...)`
  - `buildMemorySection(...)`
  - `buildMessagingSection(...)`
  - `buildAgentSystemPrompt(...)`

Why this matters:
- Easier to reason about prompt changes.
- Safer to add/remove behavior without collateral regressions.
- Enables mode-based prompt budgets.

### 2. Mode switching for context budget control

OpenClaw has explicit `PromptMode` values:
- `full`
- `minimal`
- `none`

Source:
- `.ref/openclaw/src/agents/system-prompt.ts` (`PromptMode`, prompt mode gates)
- `.ref/openclaw/docs/concepts/system-prompt.md` ("Prompt modes" section)

Why this matters:
- Sub-agents get reduced prompt overhead.
- Maintains capability while lowering token usage.

### 3. Prompt hardening for injected runtime strings

OpenClaw strips control and formatting characters before embedding untrusted values:
- `.ref/openclaw/src/agents/sanitize-for-prompt.ts`

This directly mitigates prompt-structure breakage from hostile/newline/control-char payloads.

### 4. Tool-call behavior is explicitly instructed

OpenClaw system prompt includes direct style guidance:
- Default: do not narrate routine low-risk tool calls.
- Narrate when complex/sensitive.
- Avoid polling loops.

Source:
- `.ref/openclaw/src/agents/system-prompt.ts` (`## Tool Call Style`, subagent/poll-loop guidance)

This is one reason OpenClaw can "use tools a lot" without constant verbose chatter.

### 5. Prompt observability and tests

OpenClaw validates prompt content with tests and reports:
- `.ref/openclaw/src/agents/system-prompt.e2e.test.ts`
- `.ref/openclaw/src/agents/system-prompt-report.ts`

This gives regression protection for prompt sections and token footprint.

## Infinitune Baseline (Before This Branch)

### Issues observed

- Core song prompt logic existed in duplicated modules:
  - `apps/server/src/external/llm.ts`
  - `apps/web/src/services/llm.ts` (duplicate copy)
- Frontend route handlers executed LLM prompting directly instead of delegating to backend.
- Prompt composition mixed large static strings with ad-hoc string concatenation.
- No explicit prompt-section diagnostics for song/persona/manager flows.

## Changes Implemented in This Branch

### 1. Prompt combination framework upgraded (server side)

File: `apps/server/src/external/llm.ts`

Implemented:
- Named prompt section composition via `buildPromptSections(...)`.
- Section-level diagnostics via `logPromptBuild(...)`.
- OpenClaw-style sanitization for untrusted prompt literals:
  - `sanitizePromptLiteral(...)`
  - `sanitizePromptOptional(...)`
  - `sanitizePromptList(...)`
- Structured system prompt assembly for song generation:
  - distance behavior (`close/general/faithful/album`)
  - language lock
  - optional key/time-signature/duration locks
- Structured user prompt assembly for song generation (manager brief/slot/history blocks).
- Prompt assembly refactors for:
  - `generateSongMetadata(...)`
  - `generatePlaylistManagerPlan(...)`
  - `generatePersonaExtract(...)`

### 2. Backend now owns prompt text endpoints

File: `apps/server/src/routes/autoplayer.ts`

Added backend endpoints:
- `GET /api/autoplayer/prompt-contract`
- `POST /api/autoplayer/generate-song`
- `POST /api/autoplayer/generate-album-track`
- `POST /api/autoplayer/extract-persona`
- `POST /api/autoplayer/enhance-prompt`
- `POST /api/autoplayer/enhance-request`
- `POST /api/autoplayer/refine-prompt`
- `POST /api/autoplayer/enhance-session`

Also moved album-track prompt construction to backend (`buildAlbumPrompt(...)`).

### 3. Frontend LLM duplication removed

Removed:
- `apps/web/src/services/llm.ts`

Frontend autoplayer API routes now proxy to backend:
- `apps/web/src/routes/api.autoplayer.generate-song.ts`
- `apps/web/src/routes/api.autoplayer.generate-album-track.ts`
- `apps/web/src/routes/api.autoplayer.extract-persona.ts`
- `apps/web/src/routes/api.autoplayer.enhance-prompt.ts`
- `apps/web/src/routes/api.autoplayer.enhance-request.ts`
- `apps/web/src/routes/api.autoplayer.refine-prompt.ts`
- `apps/web/src/routes/api.autoplayer.enhance-session.ts`

Model/test endpoints also proxy to backend:
- `apps/web/src/routes/api.autoplayer.ollama-models.ts`
- `apps/web/src/routes/api.autoplayer.openrouter-models.ts`
- `apps/web/src/routes/api.autoplayer.ace-models.ts`
- `apps/web/src/routes/api.autoplayer.test-connection.ts`
- `apps/web/src/routes/api.autoplayer.prompt-contract.ts`

Shared proxy helper:
- `apps/web/src/lib/autoplayer-proxy.ts`

## What We Learned From OpenClaw (Directly Applied)

1. Prompt text should be assembled from explicit named sections.
2. Untrusted runtime text must be sanitized before prompt embedding.
3. Prompt observability (section-char diagnostics) is necessary for stable evolution.
4. Tool behavior expectations should be policy-driven in prompts, not left implicit.
5. Backend should be the single authority for prompt logic and LLM calls.

## Remaining Improvement Opportunities

1. Add prompt-focused regression tests for Infinitune section presence and lock rules.
2. Add token/char budget thresholds per prompt path (song/persona/manager).
3. Add explicit prompt mode variants (for lightweight album batch generation or fast paths).
