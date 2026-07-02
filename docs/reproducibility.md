# Reproducibility / Determinism

This document tracks what makes an agent task's prompt-visible context
**deterministic** — i.e. running the same task twice (same DB state, same
inputs) feeds the agent the same context and the same sampling parameters,
so any difference in outcome is a difference in the model, not the harness.

This is a *deepening* effort: no behavior was added, only non-determinism
was removed from paths that feed an agent's prompt.

## What is now deterministic

### 1. DB query ordering (tie-breaks)

Every `findMany`/raw-SQL query that feeds a prompt (memory/RAG search,
hypothesis listing, agent-knowledge-sharing pattern/knowledge lookups,
auto-task-generator's theme list, workflow-memory-context's outcome lookup)
now has an explicit `id` (or primary key) as the final `orderBy` column, or an
`ORDER BY id ASC` for the raw SQLite vector-index scan. Without it, two rows
tying on the "real" sort key (confidence, occurrences, createdAt, …) have an
order left to the database engine's whim — which can differ between runs
even with identical data.

Files: `services/memory/rag/search.ts`, `services/memory/rag/vector-index.ts`,
`services/memory/hypothesis-service.ts`, `services/agents/agent-knowledge-sharing.ts`,
`services/ai/auto-task-generator.ts`, `services/workflow/workflow-memory-context.ts`.

Reference pattern: `services/memory/idea-box-service.ts` (`orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]`).

### 2. JS `.sort()` tie-breaks

Everywhere a DB result is re-ranked in JS by a computed float score
(`rankScore`, `relevance`, theme-bonus composites) and then truncated with
`.slice(0, n)`, the comparator now falls back to `id` when the primary score
ties. `Array#sort` is not guaranteed stable across JS-engine versions for
equal keys, so an untied comparator could silently reshuffle which entries
survive the truncation.

Files: `services/memory/rag/search.ts`, `services/memory/rag/vector-index.ts`,
`services/agents/agent-knowledge-sharing.ts`.

### 3. Sampling temperature pinned to 0 (direct-SDK paths only)

Every direct Anthropic-SDK / Ollama call that feeds an agent-visible or
user-visible generated artifact now pins `temperature: 0`:

- `services/agents/providers/anthropic-api-provider/agent.ts` — was unset
  (Anthropic API default is 1.0); now `this.config.temperature ?? 0`.
- `services/ai/auto-task-generator.ts` — `0.7` → `0`.
- `services/ai/weekly-review-service.ts` — `0.5` → `0`.
- `utils/ai-client/ollama-provider.ts` — `0.7` → `0` in all three request
  bodies (`callOllama`'s llama-server branch, `callOllama`'s Ollama-native
  branch, `callOllamaStream`), **plus a fixed `seed: 42`** in each body
  (Ollama/llama-server both support `seed` for greedy, repeatable sampling
  even outside temperature 0's typical greedy-decoding guarantee).

**CLI-driven phases (claude-code, codex, gemini CLI) were intentionally left
untouched** — see "Accepted structural residual" below.

### 4. No read-triggered mutation in memory retrieval

`services/memory/rag/search.ts`'s `searchKnowledge()` used to fire-and-forget
a `boostDecayOnAccess(entry.id, 0.05)` on every returned entry — a **read**
mutating `decayScore` / `accessCount` / `forgettingStage` in the DB. A dormant
entry could cross the 'active' threshold mid-task-run, so a later retrieval
within the *same* task (e.g. the verify phase re-querying after the research
phase already read) could see a different candidate set than the first
retrieval did — the same prompt producing a different context depending on
timing.

This was removed outright (not just made synchronous): the outcome-gated
reinforcement path already exists and already does the real reinforcement —
`services/workflow/workflow-memory-context.ts` calls `recordRetrieval(taskId,
entryIds)` after every `searchKnowledge()` call, and
`services/memory/outcome-reinforcement.ts`'s `applyOutcomeReinforcement()` is
called once the task reaches a terminal outcome, boosting on success /
penalizing on failure via the same `forgetting.ts` primitives. Reads no
longer mutate state; only a task's *outcome* does.

### 5. Sorted git-diff file listing

`services/agents/orchestrator/git-operations/diff-structured.ts`'s `getDiff()`
now sorts the returned `FileDiffRecord[]` by `filename` (`localeCompare`)
before returning. The previous order followed raw `git diff`/`git status`
output, which is not a guaranteed-stable ordering (rename detection, index
state, and git version can all reorder it) — the verifier and the
adversarial diff-review both read this list as part of the agent-visible
context.

### 6. Model-routing stability (no schema change)

`services/ai/smart-model-router.ts`'s `getSmartRoute()` re-derives the
recommended model from *live* state on every call: the model-discovery cache,
provider-cooldown status, and outcome-based escalation. Calling it fresh on
every phase/retry meant a discovery-cache rollover or a provider briefly
flapping in/out of cooldown could silently switch the model for what should
be the same phase attempt.

**Approach chosen: in-process `Map` cache**, not a DB column. Investigated
existing nullable columns first — `AgentExecutionConfig` is one row per
*task* (not per role) and its fields are all user-facing execution settings;
`AgentSession.mode` stores the role label (`workflow-<role>`) but
`AgentSession` rows are per execution attempt, not a stable per-phase slot.
Nothing fit "resolved model for this task+role" without repurposing a column
that already has an unrelated meaning, so per the hard constraint against
schema changes, no column was added.

New module: `services/ai/model-route-stability.ts`.

- `getStableSmartRoute(taskId, role, options)` — pins the routing decision in
  a `Map` keyed `` `${taskId}:${role}:${minTier}` `` (not just `taskId:role`:
  folding in `minTier` means a **deliberate** escalation — a retry/theme-outcome
  escalation or a risk-based floor raise computed in
  `workflow-orchestrator.ts`'s `routing-policy` — still re-routes, because it
  produces a different `minTier` and therefore a different cache key).
- `invalidateStableRoute(taskId, role)` — called from
  `workflow-orchestrator.ts`'s `tryProviderFallback()` (the deliberate
  provider-failure re-route path) right after a failure is classified as
  retry-worthy, so the *next* ordinary retry recomputes fresh instead of
  reusing a pin that is now known-bad.
- Wired into `services/workflow/workflow-orchestrator.ts` (the main
  auto-select call) and `routes/agents/execution/execute-route.ts` (the
  manual dev-mode auto-select call). `tryProviderFallback`'s own
  `getSmartRoute` call is intentionally left calling the router directly —
  it *is* the deliberate re-route this cache defers to.

**Resets on backend restart** (documented in the module's file header) — this
is process memory only, same category as `provider-cooldown` and
`outcome-reinforcement`'s in-memory traces, which already reset on restart.

## Accepted structural residual

**CLI-driven phases (claude-code, codex, gemini CLI) have no
temperature/seed control from this codebase.** Those agents are external
processes invoked via CLI flags; the underlying CLI tools do not expose a
temperature or seed parameter through their public interface, and modifying
the CLI runners themselves was explicitly out of scope for this pass. This
means full determinism is only achievable end-to-end for direct-API-driven
phases (Anthropic API provider, Ollama/llama-server); CLI-driven phases
remain as reproducible as the upstream CLI's own (undocumented) sampling
behavior allows.

## The 8-point determinism checklist

Use this when reviewing a new prompt-feeding code path:

1. **Sampling pinned** — any direct-SDK call feeding an agent/user-visible
   generation uses `temperature: 0` (and a fixed `seed` where the provider
   supports one). CLI-driven phases are the accepted exception (see above).
2. **DB `orderBy` includes an id tiebreak** — every `findMany`/raw-SQL query
   whose result order affects a prompt has a final unique column (`id`) in
   its `orderBy`/`ORDER BY`, not just the "meaningful" sort key.
3. **JS `.sort()` has an id/index tiebreak** — any in-memory re-rank by a
   computed float score falls back to a stable identifier when scores tie,
   especially before a `.slice()`/truncation.
4. **No read-triggered mutation** — retrieving/recalling data for a prompt
   must not mutate the state that a *later retrieval in the same run* would
   see. Gate mutation on outcome (success/failure), not on access.
5. **No wall-clock/random value leaks into a prompt** — avoid embedding
   `Date.now()`, `Math.random()`, or non-deterministic timing directly into
   prompt text or into a value that shapes *which* content gets selected
   (as opposed to timestamps that are legitimately part of the domain data).
6. **Model-routing stability** — a single phase attempt (including
   in-process retries that aren't a deliberate provider-failure/escalation
   re-route) should resolve to the same model, not re-derive it from
   transient state (discovery cache, cooldown flapping) on every call.
7. **Sorted fs/git listings** — directory scans, `git diff`/`git status`
   output, and similar OS-ordered listings that feed a prompt should be
   explicitly sorted (e.g. by path) rather than trusting OS/git iteration
   order.
8. **CI guard** — (not implemented in this pass) a lint rule or CI check that
   flags a new `findMany` missing an `orderBy`, a new `.sort()` on a
   float/score without a tiebreak, or a new direct-SDK `messages.create`
   call without an explicit `temperature`, so regressions are caught before
   merge rather than rediscovered empirically.
