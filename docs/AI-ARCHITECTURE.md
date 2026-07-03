# AI Architecture — live mechanism inventory

> An accurate map of the AI/agent-orchestration mechanisms that are actually
> wired up and running in rapitas today, with file-level evidence for each
> claim. This is not a design aspiration document — every mechanism below is
> load-bearing code, not a stub. Paths are relative to the repo root
> (`C:\Projects\rapitas`) unless noted; backend paths omit the
> `rapitas-backend/` prefix where the section already states it.
>
> For the full execution-lifecycle deep dive (worktree isolation → quality
> gate → bounded self-repair), see
> [`docs/deep-dive/safe-agent-execution.md`](./deep-dive/safe-agent-execution.md).
> This document summarizes that mechanism and adds the six others that sit
> around it.

---

## 1. Verify / self-repair loop + convergence metric

A task's `verify.md` is not trusted at face value. `runVerificationGate`
(`rapitas-backend/services/agents/orchestrator/...`, detailed in the deep
dive above) runs ESLint + `tsc --noEmit` + scoped tests against the actual
diff. When the gate — or the verifier's own self-reported result — fails,
`services/workflow/verify-self-repair.ts` (`attemptVerifyRepair`) bounces the
task back to the **implementer** phase with the failure written into
`verify.md` as feedback, instead of blocking outright. A sibling mechanism,
`services/workflow/ci-self-repair.ts` (`cause: 'ci_repair'`), does the same
for post-PR CI failures.

Both loops are **bounded**: the retry count is derived from
`WorkflowTransition` rows with `cause IN ('verify_repair','ci_repair')` since
the last `task_retried` transition, capped at `RAPITAS_MAX_VERIFY_REPAIRS`
(default 2), overridable per-user via `UserSettings.verifyRepairLimit`. Once
exhausted, the task is parked as `blocked` rather than looping forever.

The **convergence metric** — how well this loop actually works in
aggregate — is a pure read-only aggregation in
`routes/agents/agent-metrics/repair-convergence-query.ts`
(`computeRepairConvergenceStats`): it groups every task that ever entered a
repair loop by outcome (converged / blocked / still pending), and reports
`convergenceRate`, `averageIterationsToConvergence`, and an
`iterationDistribution` histogram. Surfaced via
`GET /agent-metrics/repair-convergence` and the `RepairConvergenceCard` on
the agent metrics dashboard (`rapitas-frontend/src/app/agents/metrics/`).

---

## 2. Adversarial cross-provider diff review

Before a task is allowed to complete, `services/agents/verification/adversarial-diff-review.ts`
(`reviewDiffAdversarially`) sends the task's final diff (capped at 14,000
chars via `getDiff`) plus `plan.md` and its acceptance criteria to an
**independent LLM judge**, asking for a strict pass/fail verdict with
severity and reasons in Japanese.

The judge is deliberately **not** the same provider that implemented the
task where avoidable: `JUDGE_PROVIDERS = ['claude', 'gemini', 'chatgpt']`
puts the implementer's own provider last, falling back through the others —
a cross-provider bias mitigation, not just a second opinion from the same
model family. The reply parser (`parseReviewVerdict`) tolerantly extracts a
JSON verdict block and defaults to `'unknown'` on anything unparsable.

**Fail-open by design**: any judge/infra error, or the feature flag
`RAPITAS_ADVERSARIAL_REVIEW=0`, returns `verdict: 'unknown'` rather than
blocking the task — a broken judge integration can never dead-end a task
that's otherwise done. Default: **on**.

---

## 3. Cost-aware model routing + route-stability cache

`services/ai/smart-model-router.ts` (`SmartModelRouter`) estimates the likely
token cost of a task from the historical `AgentExecution.tokensUsed` of past
tasks with a similar `complexityScore` (±15), prices tiers dynamically via
`services/ai/model-discovery` (no hardcoded model IDs — model catalogs and
pricing are looked up, not baked in), and returns a `RoutingDecision`
(recommended model/tier, alternatives, cost estimate). It also tracks a
`BudgetStatus` (spend vs. `budgetLimit` for the period).

A same-phase retry (a re-queued execution, a discovery-cache rollover, a
provider-cooldown flap) must not silently switch models mid-phase —
`services/ai/model-route-stability.ts` pins the router's decision per
`taskId:role:minTier` in an in-process cache (`getStableSmartRoute`) for the
life of the backend process, and exposes `invalidateStableRoute()` for a
*deliberate* re-route (e.g. a genuine provider failure). This is
process-memory only — a backend restart resets pinned routes, an accepted
discontinuity.

Wired into `services/workflow/workflow-orchestrator.ts` (~lines 562-654):
when a phase's `modelId === 'auto'`, the orchestrator computes escalation
(`queueItem.retryCount` + `outcome-telemetry.ts`'s
`recentThemeEscalation`) and a risk floor (`services/workflow/routing-policy.ts`
— schema/auth/payment/security work forces a premium-tier floor via
`detectHighRisk`/`computeMinTier`), then calls `getStableSmartRoute()`.

---

## 4. Local MiniLM RAG + the Japanese-cosine-inversion fix

`services/memory/rag/embedding.ts` generates 384-dim embeddings locally via
`@xenova/transformers` (`Xenova/all-MiniLM-L6-v2`) — no external embeddings
API call — with a Node-subprocess fallback (`workers/embedding-worker.cjs`)
for Bun-compatibility gaps, and gracefully no-ops if the package isn't
installed. `services/memory/rag/vector-index.ts` builds the searchable index
on top of it.

**Documented failure mode, and the fix.** `services/memory/theme-saturation.ts`
records a calibration finding: MiniLM cosine similarity is **not usable** for
Japanese near-duplicate detection in this codebase's idea/concern corpus —
genuinely novel ideas scored *higher* similarity than near-duplicate
type-guard refactors (0.70–0.78 vs 0.60), i.e. the signal is inverted for
this workload. Rather than keep a metric that actively misleads, it's
replaced with two **lexical** signals that work for Japanese where
tokenization/embeddings don't:

- `findSaturatedTheme()` — longest-common-substring match (`lcsLen`) against
  existing entries, capping how many ideas may share one theme
  (`RAPITAS_IDEA_SATURATION_CAP`, default 8).
- `findNearDuplicate()` — character-bigram Jaccard similarity
  (`bigramJaccard()`, threshold ~0.6) to catch near-identical re-filings.

Both gates are shared between `services/memory/idea-box-service.ts` and
`services/memory/concern-backlog-service.ts` (`submitIdea` is the common
choke point both the extractor and the innovation session pass through).

---

## 5. Intake gate

`services/intake/intake-gate.ts` (`ensureIntakeReady`) runs once, immediately
before the research phase. It checks spec quality
(`services/intake/spec-quality-checker.ts`); if the task description is thin,
it AI-derives goals/constraints/acceptance criteria
(`deriveTaskSpec`) from the description (and any prior `question.md` answer)
and merges them into the task row.

If the spec is still too thin to proceed confidently,
`services/intake/intake-policy.ts` (`decideIntake`) chooses between two
explicit paths — never silent guessing with no trace:

- **Ask**: write a single clarifying `question.md`, pause the workflow at
  `awaiting_question` (a `intake_question_answered` transition records the
  resume).
- **Best-guess**: proceed, but record an `intake_low_confidence`
  `WorkflowTransition` and fire a notification, so a low-confidence
  auto-run is always visible, never silent.

Idempotent — safe to call on every `draft → research` advance.

---

## 6. Eval harness: CI-blocking gate-eval + opt-in judge-eval

Two distinct eval scripts, both under `rapitas-backend/scripts/`:

- **`eval-gates.ts`** — deterministic, no DB, no live LLM calls. Runs a
  curated golden set against the actual gate logic: `looksLogPolluted`,
  `validatePlan`/`validateVerify`/`validateResearch`, `isReusableArtifact`,
  `parsePlanFiles`/`evaluateScopeCheck`, `coverageCheck`,
  `researchConcludesNoChange`, `classifyFailures`, and
  `parseReviewVerdict` (the adversarial judge's *reply parser* only — not the
  LLM call itself). Exits 1 on any miss. **Wired into CI**:
  `.github/workflows/test-lint.yml`, `test-backend` job, step "Evaluate
  workflow quality gates" (`bun run eval:gates`) — this is the part that
  actually blocks a merge.
- **`eval-judge.ts`** — opt-in, makes live LLM calls, so it is **not** run in
  CI by default (`RAPITAS_EVAL_JUDGE=1` to enable). Scores the adversarial
  judge's end-to-end accuracy against 5 labelled diff→verdict fixtures,
  threshold `RAPITAS_EVAL_JUDGE_MIN` (default 0.8). Persists its result via
  `services/observability/eval-judge-results.ts` as a single JSON snapshot
  (overwritten each run — no history file yet), surfaced through
  `GET /agent-metrics/judge-eval` and the `JudgeEvalCard` on
  `rapitas-frontend/src/app/agents/metrics/`, including the latest run's
  per-fixture pass/fail case breakdown.

---

## 7. Prompt-as-config

Agent system prompts are **database rows, not hardcoded strings** — the
`SystemPrompt` model (`prisma/schema/agents.prisma`, `key`/`content`/
`category`/`isActive`/`isDefault`). Each workflow role (researcher, planner,
reviewer, implementer, verifier, auto_verifier) points at a
`systemPromptKey` (`routes/workflow/core/workflow-roles.ts`,
`DEFAULT_PROMPT_KEYS`), editable via `PUT /workflow-roles/:role` (which
validates the key exists before saving) — so changing an agent's behavior is
a config write, not a code deploy.

At runtime, `services/workflow/workflow-orchestrator.ts`
(`resolveSystemPromptContent`) loads the active `SystemPrompt.content` for
the resolved role and passes it into the agent execution call.

A separate, related self-learning layer sits on top of this:
`services/self-learning/prompt-ops.ts` + `prompt-evolution-runner.ts` record
`PromptEvolution` rows (before/after prompt text + a measured
`performanceDelta`) whenever a role's success rate drops below threshold —
run weekly via `.github/workflows/prompt-evolution-weekly.yml`. It is
**read-only/observational**: it does not auto-promote a "winning" prompt.
The summary (`GET /learning/prompt-evolution/summary`, grouped by
`basePromptKey`) is surfaced on `rapitas-frontend/src/app/system-prompts/`
via `PromptEvolutionSummary`, including a per-group trend indicator (latest
completed swap vs. the one before it, not just the sign of the single latest
delta) built from the already-returned `recentEntries` history.

---

## Read surfaces for the above (dashboards, not new mechanisms)

These are already-wired display surfaces that make the mechanisms above
legible without reading logs or a database console:

| Mechanism | Endpoint | Frontend |
|---|---|---|
| Repair convergence | `GET /agent-metrics/repair-convergence` | `RepairConvergenceCard` |
| Adversarial review verdicts | recorded as `WorkflowTransition`s | task detail workflow log |
| Cost routing / budget | `services/ai/smart-model-router.ts` `BudgetStatus` | agent metrics dashboard |
| Per-task AI cost | `GET /tasks/:id/execution-status` (`totalSessionCostUsd`, from `AgentSession.totalCostUsd`) | task-detail execution panel (token/cost line) |
| Prompt evolution | `GET /learning/prompt-evolution/summary` | `PromptEvolutionSummary` (system-prompts page) |
| Judge eval snapshot + per-case breakdown | `GET /agent-metrics/judge-eval` | `JudgeEvalCard` (agent metrics page) |

---

## What this document is not

This is an inventory of what runs today, not a roadmap. Known open gaps
(accurate as of this writing, not aspirational promises):

- `eval-judge.ts` persists only the **latest** run (no historical accuracy
  trend across runs) — see `services/observability/eval-judge-results.ts`.
- The route-stability cache (§3) is process-memory only; it does not survive
  a backend restart.
- The adversarial judge (§2) is fail-open: a disabled or broken judge never
  blocks completion, which is a deliberate trade-off (availability over a
  false negative), not a gap — noted here so it isn't mistaken for one.
