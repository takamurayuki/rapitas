# 0009. Score a model choice on the repair loop, not on process exit

- Status: accepted
- Date: 2026-10-21
- Deciders: @takamurayuki

## Context

Two endpoints already exist to decide which model should run which workflow
phase: `/agent-metrics/cost-optimization` (cheapest model at comparable
success) and `/agent-metrics/pareto-frontier` (role × model frontier over
success rate, wall time and cost, with Wilson intervals and a sample-size
gate). Both are carefully built. Both score success as
`AgentExecution.status === 'completed'` — the CLI process exiting cleanly.

Measured 2026-10-21 over the most recent 500 executions, that axis carries no
information:

| Endpoint | Model | n | Success (95% CI) | Cost / execution |
| --- | --- | --- | --- | --- |
| cost-optimization | claude-sonnet-5-5 | 438 | 100% | — |
| cost-optimization | claude-opus-5-5 | 49 | 98% | — |
| cost-optimization | claude-haiku-5-5 | 5 | 100% | — |
| pareto standard/implementer | sonnet | 110 | 98.2% [94–100] | $1.453 |
| pareto standard/implementer | opus | 29 | 100% [88–100] | $5.396 |
| pareto standard/planner | sonnet | 58 | 100% [94–100] | $0.296 |
| pareto standard/planner | haiku | 6 | 100% [61–100] | $0.029 |
| pareto standard/planner | opus | 5 | 100% [57–100] | $1.303 |
| pareto standard/verifier | sonnet | 107 | 100% [97–100] | $1.202 |
| pareto standard/verifier | opus | 12 | 91.7% [65–99] | $1.533 |
| pareto lightweight/auto_verifier | sonnet | 52 | 100% [93–100] | $0.296 |

Every reliable point lies between 91.7% and 100%, and every interval overlaps
every other. Cost over the same rows differs by up to 45× within one role
(planner: haiku $0.029 against opus $1.303). A reader could conclude "always
take the cheapest", but that conclusion would rest on an axis that cannot
distinguish a good implementation from a bad one — only a crash from a
non-crash. The CLI exits 0 whether it implemented the requirement or wrote a
stub.

The cost axis on those two endpoints is also wrong in a known way:
`costUsd` holds the CLI's session-cumulative `total_cost_usd`, so summing the
rows counts every resumed repair cycle again (measured 5.59× on one task, and
two budget halts were false).

A axis that does vary is already recorded. In the same fortnight there were 37
`verify_repair` transitions against 59 `file_saved:verify` — a 38% bounce
rate — and each bounce belongs to a task whose phases ran under models that
are recorded per execution.

## Decision

Add `GET /agent-metrics/role-model-outcomes?days=N`, scoring each (role, model)
and each combination of roles on what the task did after that phase ran:

- **Outcome axis**: share of tasks that never bounced (`verify_repair` +
  `ci_repair`), and mean bounces per task.
- **Cost axis**: attributed per execution through `attributeIncrementalCosts`,
  the same increment walk the task budget uses. Window filtering applies to
  the increments, not the rows, so a chain that began before the window is
  still walked from its start rather than counted whole.
- **Combination key**: the model of the **last** execution of each role. A
  phase that timed out and was re-dispatched has more than one execution, and
  the output came from the model that finished it. A task missing any named
  role is dropped — a combination is a claim about those phases together.
- **Sample-size honesty**: a cell with fewer than 10 tasks reports its counts
  and returns `null` for both rates. At n=5 and n=8 a measurement in this
  repository reversed itself and only the n=12 interval was honest — see
  `rapitas-backend/scripts/variance-probe.ts`, which resamples for the same
  reason.
- Rows with no role or no model are dropped rather than bucketed as
  `unknown`. 8 of 500 executions had no model recorded, and a label for a
  model that never ran would carry real outcomes.

The existing two endpoints are left exactly as they are. They are in use, and
this is an additional axis rather than a correction of their arithmetic.

## Consequences

- The first read will mostly say "not enough tasks". opus (49 executions) and
  haiku (5) are spread over five roles, so most cells fall under the
  ten-task floor. That is the intended behaviour: the endpoint reports that
  the observational data cannot yet rank combinations, instead of ranking
  them anyway.
- Reading it at all requires a restart, because the running backend predates
  the route. The worktree's `DATABASE_URL` points at a stopped Postgres, so
  the figures could not be produced from a second process during development.
- Bounces are a **proxy** for requirement fidelity, not a measure of it. 75.4%
  of verify disputes could not be attributed to any acceptance criterion, so a
  model with a low first-pass rate is not automatically the worse model — the
  criteria may be at fault. Treat a difference as a reason to look, not a
  verdict.
- A controlled experiment is still the only way to rank combinations soon.
  Varying all four roles across three tiers is 81 combinations; the practical
  design is one factor at a time around a baseline (≈9 assignments × 2
  repeats = 18 workflow runs), scored by the thirteen deterministic gates plus
  this endpoint's bounce count and attributed cost. At the measured $2–8 per
  task that is roughly $50–150 and several hours of the single execution slot,
  which is why the instrument lands first and the experiment is scoped after
  reading it.

## Alternatives rejected

- **Fix the success axis inside pareto-frontier.** The cleanest end state, and
  where this should probably converge. Not done now because that endpoint
  drives a panel in use and its three objectives, intervals and dominance
  logic all assume a per-execution success flag; swapping in a per-task
  outcome changes what a "point" means.
- **Use the adversarial judge's verdict as the quality axis.** It is the one
  signal that speaks to requirement fidelity directly, but it was measured the
  same day to be a single juror whose fails are contested 51.4% of the time
  (ADR-0008). Scoring models against it today would propagate that noise.
- **Count `phase_failed:*` transitions.** Rarer than bounces and dominated by
  infrastructure causes (timeouts, slot exhaustion), so it measures the host
  more than the model.
