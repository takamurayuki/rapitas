# AI Architecture — live mechanism inventory

> An accurate map of the AI/agent-orchestration mechanisms that are actually
> wired up and running in rapitas today, with file-level evidence for each
> claim. This is not a design aspiration document — every mechanism below is
> load-bearing code, not a stub. Paths are relative to the repo root
> unless noted; backend paths omit the
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
(`rapitas-backend/services/agents/verification/verification-gate.ts`, detailed
in the deep dive above) runs ESLint, Prettier, `tsc --noEmit` and scoped tests
against the actual diff, plus the coverage, red-state, tamper, scope,
file-size and runtime-smoke checks. When the gate — or the verifier's own self-reported result — fails,
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
`routes/agents/agent-metrics/queries/repair-convergence-query.ts`
(`computeRepairConvergenceStats`): it groups every task that ever entered a
repair loop by outcome (converged / blocked / still pending), and reports
`convergenceRate`, `averageIterationsToConvergence`, and an
`iterationDistribution` histogram. Surfaced via
`GET /agent-metrics/repair-convergence` and the `RepairConvergenceCard` on
the agent metrics dashboard (`rapitas-frontend/src/app/agents/metrics/`).

---

## 2. Adversarial diff review (two-reviewer jury)

Before a task is allowed to complete, `services/agents/verification/adversarial-diff-review.ts`
(`reviewDiffAdversarially`) has the task's final diff judged against `plan.md`
and its acceptance criteria by reviewers that did not write it. The diff text
is built by `jury-diff-text.ts`, capped at 48,000 characters
(`MAX_DIFF_CHARS`) with explicit per-file truncation.

Two blind reviewer seats judge independently (`two-seat-jury-run.ts`). When
they agree, that settles the verdict. Only when they disagree does a
non-voting verifier seat check the grounds of the disputed findings. This
replaced a three-seat majority vote (owner decision 2026-11-10; background in
[ADR-0008](adr/0008-jury-of-claude-models.md)). Seat models and the provider
order (`JUDGE_PROVIDERS`, used when more than one vendor is reachable) are in
`jury-panel.ts`. Per-juror verdicts are written to the timeline.

On FAIL the workflow goes back to the implementer. When no reviewer produced a
verdict, or the review errored, the outcome depends on risk
(`jury-unavailable-outcome.ts`): low-risk work proceeds as `'unknown'`, and
high-risk work becomes `'hold'`, parked for a human. Default: **on**; set
`RAPITAS_ADVERSARIAL_REVIEW` to `0`, `false` or `off` to skip it.

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
task, role and tier constraints (`minTier`, `capTier`, `hardCapTier`) for up to
`PIN_TTL_MS` (24 hours) via `getStableSmartRoute`, and exposes
`invalidateStableRoute()` for a _deliberate_ re-route (e.g. a genuine provider
failure, from `services/workflow/workflow-provider-fallback.ts`). The pin is
kept in memory and also written to the timeline as a `model_route_pin` event,
so it survives a backend restart; reading or writing it fails open to a fresh
routing decision.

Wired in through `services/workflow/role-route-inputs.ts` (`routeModelForRole`):
when a phase's `modelId === 'auto'`, it computes escalation
(`queueItem.retryCount` + `outcome-telemetry.ts`'s
`recentThemeEscalation`) and a risk floor (`services/workflow/routing-policy.ts`
— schema/auth/payment/security work forces a premium-tier floor via
`detectHighRisk`/`computeMinTier`), then calls `getStableSmartRoute()`.
Path-shaped risk signals in a plan (`prisma/schema`, `migrations/`, `/auth`,
`payment`, …) are judged only against the files its 変更予定ファイル section
declares (`services/workflow/plan-declared-files.ts`) — a dependency table or a
non-goal row naming a schema file does not buy a premium floor. When that
section yields no path the probe falls back to the scrubbed full text.

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
genuinely novel ideas scored _higher_ similarity than near-duplicate
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

### 4.1 Hybrid recall, model switch, decay, and the recall metrics (task #658)

Measured on 2026-08-24: 140 agent executions produced 7 `memory_retrieval`
events — recall was structurally dead. Three causes and their fixes:

| Cause                                                                                                                                         | Fix                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recall was pinned to `forgettingStage: 'active'` (10 % of the KB) while sweep-archived rows kept their vectors and crowded the candidate pool | `services/memory/recall/` — every stage is a candidate (`RAPITAS_KB_RECALL_STAGES`), demoted by a per-stage rank weight (`RAPITAS_KB_RECALL_STAGE_WEIGHTS`), with a `休眠中 / アーカイブ済み` marker in the prompt                                                                                                                                                                                                  |
| English-only embedding model → Japanese queries never cleared the cosine floor                                                                | Hybrid search: vector channel (`services/memory/rag/search.ts`) + character-bigram/IDF lexical channel (`services/memory/recall/lexical-index.ts`) fused by RRF (`services/memory/recall/rank-fusion.ts`). The model is `RAPITAS_EMBEDDING_MODEL` (multilingual opt-in); `searchSimilar` only compares rows embedded by the model actually loaded, and `services/memory/rag/reindex/` re-embeds the KB in resumable chunks (`reembed` queue job, `POST /memory/embeddings/reindex`) |
| Decay compounded nightly from `lastAccessedAt` and re-applied the confidence factor every sweep, so boosted entries archived fastest          | `forgetting.ts`: `decay × r^((2 − confidence) × daysSinceLastDecay)`, `r = RAPITAS_KB_DECAY_DAILY_RETENTION`                                                                                                                                                                                                                                                                                                        |

Every recall attempt (including empty ones) writes a `memory_recall_attempt`
event; `GET /memory/recall/metrics?days=` and `/knowledge/stats.recall` report
attempts, non-empty rate, and attempts per agent execution — the number to
compare against the pre-change baseline of 7 / 140 ≈ 0.05. Thresholds,
stages, weights, model and decay are all environment-driven; see the
`Knowledge recall / embeddings` block in `rapitas-backend/.env.example`.

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
  `parseReviewVerdict` (the adversarial judge's _reply parser_ only — not the
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

| Mechanism                                | Endpoint                                                                                    | Frontend                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Repair convergence                       | `GET /agent-metrics/repair-convergence`                                                     | `RepairConvergenceCard`                        |
| Adversarial review verdicts              | recorded as `WorkflowTransition`s                                                           | task detail workflow log                       |
| Cost routing / budget                    | `services/ai/smart-model-router.ts` `BudgetStatus`                                          | agent metrics dashboard                        |
| Per-task AI cost                         | `GET /tasks/:id/execution-status` (`totalSessionCostUsd`, from `AgentSession.totalCostUsd`) | task-detail execution panel (token/cost line)  |
| Prompt evolution                         | `GET /learning/prompt-evolution/summary`                                                    | `PromptEvolutionSummary` (system-prompts page) |
| Judge eval snapshot + per-case breakdown | `GET /agent-metrics/judge-eval`                                                             | `JudgeEvalCard` (agent metrics page)           |

---

## What this document is not

This is an inventory of what runs today, not a roadmap. Known open gaps
(accurate as of this writing, not aspirational promises):

- `eval-judge.ts` persists only the **latest** run (no historical accuracy
  trend across runs) — see `services/observability/eval-judge-results.ts`.
- The adversarial review (§2) fails open only for low-risk work: when no
  reviewer gives a verdict, low-risk work proceeds as `'unknown'`, while
  high-risk work is held for a human (`'hold'`). This is a deliberate
  trade-off, not a gap.
