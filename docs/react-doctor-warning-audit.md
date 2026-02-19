# React Doctor Warning Audit

Date: 2026-02-19  
Command: `npx -y react-doctor@latest . --verbose --diff --yes --project @infinitune/web`  
Result: `98/100`, `0 errors`, `7 warnings`, `3 files`

## What Was Fixed In This Pass

1. Removed all `no-fetch-in-effect` errors by moving testlab metadata/model requests to React Query hooks.
2. Removed all `label-has-associated-control` warnings by wiring explicit `htmlFor` + `id` associations and using `fieldset/legend` for the provider control group.
3. Removed the prior `no-cascading-set-state` warning in the LLM test page by simplifying model synchronization logic.

## Remaining Warnings

| File | Rule | Severity | Root Cause | Risk | Disposition |
| --- | --- | --- | --- | --- | --- |
| `apps/web/src/routes/autoplayer_.testlab.llm.tsx:33` | `react-doctor/prefer-useReducer` | warning | Multiple related local UI states are managed with separate `useState` calls. | Low | Defer (incremental refactor) |
| `apps/web/src/routes/autoplayer_.testlab.llm.tsx:33` | `react-doctor/no-giant-component` | warning | LLM test route combines config UI, results list, and detail rendering in one large component. | Low | Defer (extract panels) |
| `apps/web/src/routes/autoplayer_.testlab.llm.tsx:49` | `react-doctor/no-effect-event-handler` | warning | Settings-to-local-state synchronization occurs in an effect (`provider`/`model` bootstrap). | Low | Defer (replace with explicit initialization strategy) |
| `apps/web/src/routes/autoplayer_.testlab.e2e.tsx:55` | `react-doctor/prefer-useReducer` | warning | Pipeline screen tracks many related UI states independently. | Low | Defer (state reducer extraction) |
| `apps/web/src/routes/autoplayer_.testlab.e2e.tsx:55` | `react-doctor/no-giant-component` | warning | Pipeline orchestration and view rendering are in one route component. | Medium | Defer (split orchestration vs presentational panels) |
| `apps/web/src/routes/autoplayer.tsx:96` | `react-doctor/prefer-useReducer` | warning | The main player route has several independent local states mixed with hook-driven state. | Medium | Defer (group transient UI state only) |
| `apps/web/src/routes/autoplayer.tsx:96` | `react-doctor/no-giant-component` | warning | Main route remains a broad composition surface with many responsibilities. | Medium | Defer (targeted extraction sequence) |

## Follow-Up Plan (Incremental, Low Risk)

1. `autoplayer_.testlab.llm.tsx`
- Extract `LlmConfigPanel` (prompt/provider/model controls and generate action).
- Extract `PromptContractPanel` (system prompt + schema viewer).
- Extract `GenerationResultsPanel` (history list and expanded details).
- Optional reducer pass for related config state only (`prompt`, `provider`, `model`).

2. `autoplayer_.testlab.e2e.tsx`
- Extract `PipelineConfigPanel` (prompt + run/cancel/reset controls).
- Extract `PipelineStepsPanel` (step cards + retry orchestration wiring).
- Extract `PipelinePreviewPanel` (cover/audio/song summary).
- Introduce reducer for `steps + run-state transitions` only.

3. `autoplayer.tsx`
- Phase 1: extract route-header/nav action cluster.
- Phase 2: extract album generation controls/progress state.
- Phase 3: isolate detail panel and playlist action callbacks.
- Keep playback/room synchronization logic intact during extraction.

## Acceptance Criteria For Next Pass

1. React Doctor remains at `0 errors`.
2. Warnings reduced by at least:
- `-2` for testlab pages after component extraction.
3. No regression in:
- LLM test generate flow.
- E2E pipeline run/cancel/reset/retry flow.
- Autoplayer normal playback and room mode behavior.
