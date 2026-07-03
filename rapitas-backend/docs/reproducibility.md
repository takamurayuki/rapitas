# Reproducibility

How the agent pipeline keeps a given task's prompt-visible context — and the
decisions made from it — **stable across identical runs**. The goal is not
bit-for-bit identical LLM output (impossible with the CLI runners; see
[Accepted structural residual](#accepted-structural-residual)), but that the
*inputs* an agent sees, and the *selection decisions* the workflow makes, do not
silently reshuffle between two runs of the same task.

## Why it matters

A prompt is a prefix: reorder the recalled lessons, swap which "best mode" wins a
tie, or let a wall-clock value leak into prompt text, and two identical runs
diverge before the model even samples. That destroys prompt-cache hit rates,
makes failures unreproducible, and lets a tied ranking pick a different winner
each run. The guarantees below close the deterministic-input side; the sampling
side is bounded where we control it and documented where we don't.

## The 8-point checklist

The prompt-critical directories — `services/memory`, `services/workflow`,
`services/agents`, `services/ai`, `routes/agents` — must hold to these:

1. **Ordered DB reads that feed a prompt.** Any `findMany` whose result is
   rendered into a prompt (or drives a `take`/slice that does) carries an
   explicit `orderBy` with a terminal unique tie-break (`{ id: 'asc' }`). Reads
   that collapse into a `Set`/`Map` or drive independent per-item work are
   order-independent and exempt.
2. **Deterministic single-row picks.** A `findFirst` that isn't filtered on a
   unique column carries an `orderBy` so the row picked can't vary run to run.
3. **Stable JS sorts.** Every comparator that orders prompt-visible content or an
   execution-selection decision (which model, which workflow mode) has a
   secondary tie-break (`|| a.id - b.id`, or a text/key fallback when no id
   exists). `Array#sort` is not guaranteed stable across engines for equal keys.
4. **Pinned direct-SDK temperature.** Direct Anthropic/OpenAI/Ollama SDK calls
   that produce prompt output pin `temperature: 0` — **model-aware** (see below).
5. **Fixed local-LLM seed.** Local inference (Ollama / llama-server) sends a
   fixed `seed` alongside `temperature: 0` for greedy, repeatable sampling.
6. **No wall-clock / randomness in prompt text.** Prompt-builder files never let
   `Date.now()`, `new Date()`, `Math.random()`, or `crypto.randomUUID()` shape
   prompt text or which content is selected.
7. **Pinned route decisions per phase.** `getStableSmartRoute` pins the routing
   decision per `(taskId, role, minTier)` for the process lifetime, so a
   same-phase retry doesn't silently switch models mid-phase.
8. **CI guard.** `scripts/check-determinism.cjs` scans the directories above for
   the source patterns behind points 1–6 (heuristic, dependency-free). Run
   `--strict` to fail CI on any finding; suppress a genuine false positive with a
   `// determinism-ok: <reason>` comment on the line directly above the flagged
   line.

### Temperature is model-aware

`temperature: 0` is pinned **only for models that still accept the parameter**.
The Claude 5 family / Opus 4.7–4.8 / Sonnet 5 **removed** `temperature` and
return HTTP 400 on any value, so the direct-SDK wrapper omits it entirely for
those models. The gate is `modelAcceptsTemperature(modelId)` (exported from
`services/agents/providers/anthropic-api-provider/agent.ts`): older models get
`temperature: config.temperature ?? 0`; rejecting models get the param omitted.
For those newer models, determinism is steered by prompt content and model
choice rather than a sampling parameter (temperature 0 never guaranteed
identical output on prior models either).

## Accepted structural residual

The **dominant execution path** — the Claude Code, Codex, and Gemini CLIs — has
**no temperature or seed control** exposed to this codebase. The CLIs own
sampling; we cannot pin it. Their prompt *inputs* are still held deterministic
(points 1–3, 6 apply to their prompt builders), but two runs of the same task
can still produce different model output. This is an accepted structural
residual, not a defect. The CLI-runner files are therefore exempt from the
temperature checks (rule 4) in `check-determinism.cjs`, but **not** from the
prompt-text wall-clock/random check (rule 6).

### Recommendation — pin explicit model versions, not aliases (low-risk CLI lever)

The one remaining low-risk determinism lever for CLI runs is **configuring an
explicit, dated model version rather than a moving alias**. An alias such as
`claude-sonnet-4` silently re-points when a new snapshot ships, so the same task
config can start behaving differently after a provider-side model update with no
change on our side. Pinning a specific version (e.g. `claude-sonnet-4-20250514`)
makes model drift an explicit, reviewed config change instead of an invisible
one. This is a configuration recommendation only — it does not remove the
sampling residual above, and it is intentionally **not** enforced in code, since
staying current with a model line is often the desired behavior.
