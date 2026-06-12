# Deep-dive: Letting an AI safely modify a real codebase

> How rapitas lets an autonomous coding agent take a task and finish it — research → plan → implement → verify — **without touching your working tree** and **without shipping code that doesn't lint or type-check.**
>
> Paths below are relative to `rapitas-backend/`.

---

## The problem

Give an LLM agent write access to a repository and three things go wrong:

1. **It edits in place.** Your working tree is now a mix of your changes and the agent's, mid-task. Concurrent runs collide.
2. **It produces broken diffs.** "Done!" — but the code doesn't compile, or a rename left dangling references. You find out at review time, or worse, after merge.
3. **It hallucinates success.** The agent writes "all tests pass ✅" in its summary while the diff clearly doesn't.

A useful autonomous agent needs **isolation**, an **objective quality gate**, and **bounded self-correction** — not just a good prompt.

## Design constraints

- **Local-first, multi-CLI.** Runs on the user's machine; the agent CLI (Claude Code / Codex / Gemini) is interchangeable. No reliance on a hosted CI.
- **Fail-closed.** If we *can't* prove the diff is clean, we block it — we never wave it through.
- **Bounded.** Self-repair must terminate; an agent that can't fix its errors gets parked, not looped forever.
- **Auditable.** Every state transition is recorded; the workflow can't silently regress.

---

## The execution lifecycle

```
POST /tasks/:id/execute
   │  acquire per-task lock; require an explicit workingDirectory
   ▼
createWorktree(baseDir, branch, taskId)         ── git worktree add → .worktrees/task-<id>-<hex>/
   │  store path in AgentSession.worktreePath
   │  link node_modules / .env via setup-worktree.cjs (no install in worktree)
   ▼
AgentWorkerManager.executeTask(...)             ── agent CLI runs as a subprocess, cwd = worktree
   │  (may pause as awaiting_question; resumes via executeContinuation)
   ▼
runVerificationGate(taskId, worktreePath, sid)  ── ESLint --format json + tsc --noEmit on CHANGED files
   │
   ├── ok ──▶ auto-commit → auto-PR (→ auto-merge) ──▶ removeWorktree()
   │
   └── not ok ──▶ retryOrBlock()
                    ├── attempt ≤ maxRetries(=2): re-run agent in SAME worktree with
                    │                              the lint/type errors as feedback → re-verify
                    └── exhausted / unverifiable:  task → blocked, session → failed
```

---

## Part 1 — Isolation: a git worktree per execution

Each execution gets its own worktree, created in `services/agents/orchestrator/git-operations/worktree-ops.ts`:

```ts
// worktree-ops.ts
export async function createWorktree(
  baseDir: string, branchName: string, taskId?: number, ...
): Promise<string>
// path: <baseDir>/.worktrees/task-<id>-<randomHex4>/   (collision-free, per run)
```

- The absolute path is persisted to `AgentSession.worktreePath` (nullable; set during execution, cleared on cleanup).
- Dependencies are **linked, not installed**: `scripts/setup-worktree.cjs` junctions the parent checkout's `node_modules` / Prisma client / `.env` into the worktree. (Running `bun/pnpm install` inside a worktree would corrupt the shared dependency tree — an explicit project invariant.)
- Removal (`removeWorktree`) tears the junctions down first, then `git worktree remove --force`, with a filesystem-`rm` fallback and a retry loop for Windows file-lock flakiness. Destructive ops are guarded so the main repo / `.git` can never be deleted.
- A **cleanup scheduler** (`services/scheduling/worktree-cleanup-scheduler.ts`, ~30 min) reaps worktrees for terminal sessions and removes filesystem orphans not tracked by git — so abandoned runs don't accumulate.

**Why a worktree and not a branch-in-place?** A worktree gives the agent a *physically separate* checkout sharing the same `.git`. The user can keep working on the main checkout; concurrent agent runs don't collide; and cleanup is "delete a directory," not "stash/reset and hope." The cost is disk + the node_modules-linking dance — worth it for the isolation guarantee.

---

## Part 2 — The verification gate

Before any diff becomes a commit, `services/agents/verification/verification-gate.ts` runs it through `automated-verifier.ts`:

```ts
export async function runVerificationGate(
  taskId: number, worktreePath: string, sessionId?: number,
): Promise<{ ok: boolean; result: VerificationResult | null }>
```

What it does:

- **Scopes to the agent's changes.** It diffs the worktree to find changed files and runs checks against *those*, so pre-existing project errors don't fail the gate (and the agent isn't blamed for them).
- **Lint:** `eslint --format json` on changed files; counts **errors only** (warnings ignored). If ESLint is configured but the binary can't run, that's treated as *unverifiable* → fail-closed.
- **Type-check:** `tsc --noEmit --pretty false` when a `tsconfig.json` exists; errors are filtered to the files the agent touched.
- **Bounded I/O:** each command runs via async `spawn` (never `execSync`) with a **180s timeout** and a **2KB** detail cap, so a runaway check can't hang or flood the log.
- **Result:** `{ ok, changedFiles, checks[], summary, unverifiable? }`, e.g. `summary: "lint=ok / typecheck=NG(2)"`.

Crucially, the gate **guards both paths to a PR** — the post-execution review (`routes/agents/execution/post-execution-review.ts`) and the verify.md auto-commit (`routes/workflow/workflow-auto-commit.ts`) both call `runVerificationGate()` first. There's no back door.

**Why fail-closed / changed-files-only?** Fail-closed because a gate that passes when it can't actually check is worse than no gate (false confidence). Changed-files-only because a repo with pre-existing type errors would otherwise make *every* agent run fail for reasons the agent didn't cause — the gate must measure the agent's *marginal* damage.

---

## Part 3 — The self-repair retry loop

A failing gate doesn't immediately give up. `services/agents/verification/verification-retry.ts`:

```ts
export async function retryOrBlock(params: RetryParams): Promise<{ retried: boolean }>
// DEFAULT_MAX_RETRIES = 2  (configurable per task via AgentExecutionConfig.maxRetries)
```

- The retry count lives in `AgentSession.metadata` (`parseRetryCount` / `withRetryCount`).
- On a fixable failure, it re-runs the agent **in the same worktree** (`continueFromPrevious: true`) with a generated fix instruction (`buildFixInstruction`) that hands back the exact lint/type errors, then re-verifies via an `onReverify` callback.
- **Unverifiable → block immediately** (don't burn retries on a broken toolchain).
- **Exhausted → `blockTaskForVerification`**: the task is marked `blocked` and the session `failed`, with the failing checks attached as evidence — a human picks it up instead of an infinite loop or a bad merge.

So the worst case is bounded: *original attempt + 2 repairs = 3 tries*, then a clean stop.

---

## Part 4 — A workflow state machine that can't regress

The agent doesn't freely write files; it advances a state machine (`routes/workflow/handlers/workflow-handlers-files.ts`):

```
draft → research_done → plan_created → [plan_approved] → in_progress → verify_done → completed
                                            (approval gate)        (+ awaiting_question pause/resume)
```

An invariant table gates which workflow file each status may write:

```ts
const ALLOWED_FILE_TYPES_BY_STATUS = {
  draft:         new Set(['research', 'question']),
  research_done: new Set(['plan', 'question', 'research']),
  plan_created:  new Set(['plan', 'question']),
  in_progress:   new Set(['verify', 'question']),
  verify_done:   new Set([]),  completed: new Set([]),
  // …
};
```

This makes "save research.md *after* verify.md" impossible — the agent can't quietly regress the workflow. Transitions are recorded append-only (audit trail), and `awaiting_question` lets a run pause for a human answer and resume to its prior state. The plan stage is an explicit **approval gate** (large plans auto-split into dependency-ordered subtasks). The verify stage also rejects **self-contradictory** reports (e.g., "all tests pass" alongside failures) so a hallucinated success can't trigger a PR.

---

## Part 5 — Auto-commit / PR, scoped to the worktree

`routes/workflow/workflow-auto-commit.ts` runs git **inside the worktree** (`gitCwd = session.worktreePath || workingDirectory`), and only after the gate passes:

1. Requires an **explicit** `workingDirectory` (or the theme's) — refuses to run otherwise, so the agent can never accidentally commit into rapitas's own source.
2. `createBranch` → `createCommit` → `createPullRequest` (verify.md becomes the PR body) → optional `mergePullRequest`.
3. **`removeWorktree` only after the PR is confirmed**, then clears `AgentSession.worktreePath`.

---

## Tradeoffs & decisions

| Decision | Why | Cost |
| --- | --- | --- |
| Worktree per run | True isolation; safe concurrency; trivial cleanup | Disk; node_modules-linking step |
| Gate = lint + type-check | Objective, fast, language-server-grade signal without a test suite | Doesn't catch logic bugs (tests are the next gate) |
| Changed-files-only | Measure the agent's marginal damage, not the repo's debt | Won't catch a change that breaks an *unedited* file's types (mitigated: tsc still surfaces cross-file errors in changed files) |
| Fail-closed / unverifiable=block | A gate that passes blind is worse than none | Occasionally blocks on a tooling hiccup |
| Retry cap = 2 | Bounded self-repair; no infinite loops | An agent that needs 4 tries gets parked for a human |
| Gate on **both** PR paths | No back door to merge unverified code | Slight duplication, deliberately shared via one `runVerificationGate` |

## Failure modes handled

- Agent edits break compilation → gate catches → self-repair → (if needed) blocked, never merged.
- Toolchain can't run in the worktree → unverifiable → blocked (not a false pass).
- Agent pauses for a question → `awaiting_question` → resumes without losing state.
- Run abandoned / process crashes → cleanup scheduler reaps the worktree; startup recovery marks stale executions interrupted.
- Concurrent execute on the same task → per-task lock rejects the second.

## Limitations & next steps

- **Test execution** is the obvious third gate (lint → type → tests). Today the gate is lint + type only.
- Retry state lives in **session metadata**; persisting it as first-class DB columns would make it queryable and survive schema changes more cleanly.
- The gate trusts the agent's reported changed-file set + a worktree diff; a malicious agent is out of scope (this is a personal productivity tool, not a sandbox for untrusted code).

## File map

| Concern | File |
| --- | --- |
| Worktree create/remove/orphan-cleanup | `services/agents/orchestrator/git-operations/worktree-ops.ts` |
| Worktree cleanup scheduler | `services/scheduling/worktree-cleanup-scheduler.ts` |
| Worktree dependency linking | `scripts/setup-worktree.cjs` |
| Agent worker (separate process) | `services/agents/agent-worker-manager.ts` |
| Verification gate (entry) | `services/agents/verification/verification-gate.ts` |
| Lint / type-check runner | `services/agents/verification/automated-verifier.ts` |
| Self-repair retry loop | `services/agents/verification/verification-retry.ts` |
| Workflow state machine + invariants | `routes/workflow/handlers/workflow-handlers-files.ts` |
| Auto-commit / PR (gate-guarded) | `routes/workflow/workflow-auto-commit.ts` |
| Post-execution review (gate-guarded) | `routes/agents/execution/post-execution-review.ts` |
| Models: `AgentSession`, `AgentExecution` | `prisma/schema/agents.prisma` |
