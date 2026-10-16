# 0007. Always-red CI gates: file-size ratchet and Full Suite (Advisory)

- Status: accepted
- Date: 2026-08-17
- Deciders: @takamurayuki

## Context

Task 600 (2026-08-17). PR #375 inherited two red CI checks that had nothing to
do with its own changes, and PR #350 had already been merged on 2026-08-11 with
one of them red. A check that is red on every PR carries zero information — it
trains everyone (humans and agents) to ignore CI entirely, which is worse than
the underlying violations. Two checks were in that state:

| Check | Reported cause (task) | Actual root cause (measured) |
|---|---|---|
| Enforce per-file line limits | baseline files keep growing | 1 NEW hard violation absent from the baseline (`services/agents/orchestrator/stale-execution-recovery.ts`, 514 lines) plus 7 GREW files; the gate logic itself already fails only on GREW/NEW |
| Full Suite (Advisory) | bun `mock.module` cross-file pollution | 4 test files (`agent-orchestrator.{delegation,lifecycle,state-and-events,stop}.test.ts`) carry a stale mock of `./orchestrator/recovery-manager` missing the `startExecutionLeaseSweep` export added in `f996dff5`; each file fails in isolation, before any test runs |

Measurement notes (2026-08-17, clean develop checkout):

- `node scripts/check-large-files.cjs` fails with `1 NEW file(s) exceed the
  hard limit`. None of the 27 baseline entries is a failure cause on its own.
- `bun test --isolate services/agents/agent-orchestrator.stop.test.ts` fails
  alone with `SyntaxError: Export named 'startExecutionLeaseSweep' not found` —
  disproving the cross-file-pollution theory for THIS failure (real bun
  `mock.module` pollution does exist, but it is not what broke these files).
- CI's Full Suite already runs one OS process per test file
  (`rapitas-backend/scripts/parallel-test.ts` spawns
  `bun test --isolate <file>` per file), so "make CI use per-file isolation"
  was already satisfied before this task.

The file-size drift mechanism: `.github/workflows/file-size.yml` triggers on
`pull_request` only, so direct pushes to `develop` skip the gate and drift
accumulates. This happened once before and was silenced by a wholesale baseline
update (`7f1b39d0`, 2026-08-07) — after which 7 files grew past the new
baseline within 10 days and reproduced the exact same situation. A second
contributing cause: nothing told the implementer, at coding time, that the file
being edited was already over the limit; the violation only surfaced in CI,
after all the work was done.

## Decision

### 1. File-size gate: GREW/NEW-only failure is the contract; wholesale baseline updates are prohibited

The ratchet semantics — fail only when a baseline file grows past its snapshot
(GREW) or a non-baseline file exceeds 500 lines (NEW); baseline files at or
below their snapshot pass — are the intended contract (the task's requested
option (b)). The logic already implemented this; task 600 pins it with tests
(`scripts/check-large-files.test.cjs`, run as a CI step before the scan) so a
regression is caught mechanically.

Wholesale baseline updates (`--update-baseline` over the whole tree to silence
a red gate) are prohibited: `7f1b39d0` proved they merely reset the clock while
disabling the only mechanism that stops growth. A baseline entry may only be
REMOVED, by splitting the file below 500 lines. Threshold values (soft 300 /
hard 500) are unchanged.

### 2. Make the limits visible at implementation time

`services/workflow/workflow-file-size-context.ts` injects a "file-size
awareness" section into the implementer's prompt: for every file the approved
plan references, its CURRENT measured line count when it already exceeds the
soft/hard limit. The implementer now knows before the first edit that a target
file must not grow — instead of discovering it in CI after the work is done.
Best-effort (fail-open): resolution failures produce an empty section, never a
blocked phase.

### 3. Split order for the 7 GREW files (recorded here; splitting is separate tasks)

Priority is recent change frequency (30-day, then 60-day, then all-time git
commit counts): the more often a file is touched now, the sooner it will be
touched again and re-grow, so splitting it first buys the most.
Measured 2026-08-17 with `git log --oneline --since="<N> days ago" -- <file> |
wc -l`; baseline = `.baselines/file-size.json` (2026-08-07 snapshot).

| Priority | File | 30d | 60d | All-time | Lines | Over baseline |
|---|---|---|---|---|---|---|
| 1 | `rapitas-desktop/src-tauri/src/main.rs` | 17 | 23 | 41 | 840 | +40 |
| 2 | `rapitas-backend/services/workflow/workflow-cli-executor.ts` | 11 | 27 | 50 | 1245 | +56 |
| 3 | `rapitas-backend/services/workflow/workflow-context-builder.ts` | 10 | 36 | 42 | 733 (+ a 9-line hook from task 600) | +48 |
| 4 | `rapitas-backend/services/workflow/workflow-orchestrator.ts` | 9 | 39 | 67 | 1255 | +27 |
| 5 | `rapitas-backend/services/workflow/auto-run/theme-auto-run-scheduler.ts` | 6 | 20 | 25 | 868 | +180 |
| 6 | `rapitas-backend/services/agents/orchestrator/git-operations/worktree-ops.ts` | 6 | 11 | 25 | 820 | +10 |
| 7 | `rapitas-backend/services/agents/verification/automated-verifier.ts` | 4 | 11 | 18 | 963 | +6 |

`theme-auto-run-scheduler.ts` has the largest overshoot (+180) but ranks 5th:
overshoot measures past growth, change frequency predicts future growth, and
the gate only breaks when a file grows AGAIN. `workflow-context-builder.ts`
deserves its 3rd place doubly — task 600 itself had no choice but to add a
small hook to it (Decision 2 requires wiring in the context builder), which is
exactly the "every task touches it" dynamic that makes frequent files urgent.

### 4. Full Suite (Advisory): fix the identified breakage, keep the job, keep the promotion path

The 4 stale-mock test files are fixed (add the missing
`startExecutionLeaseSweep` stub; one additional stale assertion in
`delegation.test.ts` updated for the `keepPaths` parameter added in
`ddb4bd89`). The job stays advisory for now — NOT as an excuse for redness, but
because `.github/TESTING_POLICY.md` §6 already defines the escalation contract:
20 consecutive green runs promote a suite to a hard gate. This fix starts that
count. The difference from "advisory so red is fine": the red had an identified
root cause, it is actually fixed, and there is a dated, mechanical path to
making the check blocking.

## Alternatives considered

1. **(a) Make the file-size gate required and block merges while red** — restores
   discipline immediately, but develop stays red until all 28 baseline files
   are split (weeks of work); every unrelated PR is blocked meanwhile. Rejected
   by the task itself in favor of (b).
2. **(b) Fail only on GREW/NEW** — adopted (Decision 1). It was already the
   implemented behavior; the task's real gap was that nothing pinned or
   documented it.
3. **Rewrite the gate to fail on all hard violations including baseline
   entries** — same outcome as (a) via different mechanics; rejected for the
   same reason.
4. **Warn after verification instead of before implementation (hook in
   `automated-verifier.ts`)** — avoids touching the oversized context builder,
   but reproduces the core complaint: the agent still learns about the limit
   only after the work is done. Rejected.
5. **Delete the Full Suite (Advisory) job** — makes the always-red count zero
   by definition, but removes the only net that catches exactly this class of
   regression (a new export breaking stale mocks) and removes the entry point
   of the §6 promotion path. Rejected.

## Consequences

- Positive: the ratchet contract is now test-pinned and documented; the
  implementer sees limits at coding time; the Full Suite red has an actual fix
  and a promotion path; the split order is decided on measured data.
- Negative: the file-size gate REMAINS red on develop until the NEW violation
  (`stale-execution-recovery.ts`) and the 7 GREW files are addressed by their
  own tasks — this ADR does not turn it green, and honestly says so.
  `workflow-context-builder.ts` grew by a few more lines (the unavoidable hook).
- Neutral: `CHECK_LARGE_FILES_ROOT` env override and `computeGateOutcome`
  export exist for tests only; unset/CLI behavior is byte-identical.

## Follow-ups

- [ ] Split the 7 GREW files in the priority order of Decision 3 (one task per
  file; remove each `.baselines/file-size.json` entry as its file drops below
  500 lines). Not filed as subtasks here — subtask splitting is disabled in
  this environment (`RAPITAS_ENABLE_SUBTASK_SPLIT` off).
- [ ] Resolve the NEW violation `services/agents/orchestrator/stale-execution-recovery.ts`
  (514 lines): split it below 500.
- [ ] Consider adding a `push: [develop]` trigger to `file-size.yml` so drift
  can no longer accumulate silently between PRs.
- [ ] Track Full Suite (Advisory) green streak; promote per TESTING_POLICY §6
  after 20 consecutive green runs.
