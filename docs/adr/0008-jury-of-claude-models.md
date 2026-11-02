# 0008. Rebuild the adversarial jury out of Claude models

- Status: accepted
- Date: 2026-10-21
- Deciders: @takamurayuki

## Context

`adversarial-diff-review` is the only verification gate whose verdict a model
decides. The other thirteen checks in `automated-verifier`
(lint/typecheck/test/format/generated-sync/scope/coverage/runtime/tamper/
acceptance/schema-change/red-state/file-size) make no model calls at all, and
neither do `completion-gate`, `phase-output-validator` or `verification-gate`.
That separation is deliberate and should stay.

The gate was built as a **cross-provider jury** on an explicit research basis
(recorded in the module header): a single LLM judge is near-chance on
objective correctness (JudgeBench, arXiv:2410.12784), a small heterogeneous
jury beats one frontier judge at a fraction of the cost (PoLL,
arXiv:2404.18796), and independent votes beat debate protocols
(arXiv:2508.17536). Three jurors — Claude, Gemini, OpenAI — voted by majority,
ties breaking to fail.

That jury no longer existed. Measured 2026-10-21 over all 876 recorded
`adversarial_review` timeline events (2026-07-14 → 2026-10-19):

| Month   | Reviews | Reviews with exactly 0 or 1 real voter |
| ------- | ------- | -------------------------------------- |
| 2026-07 | 47      | 4.3%                                   |
| 2026-08 | 314     | 13.7%                                  |
| 2026-09 | 306     | 74.8%                                  |
| 2026-10 | 209     | **100.0%**                             |

Every non-Claude juror now answers `Requested provider unavailable in
Claude-only auxiliary CLI mode` (600 of 602 sampled unknown juror rows). This
is correct behaviour on the part of `askJuror`: auxiliary AI runs entirely
through `claude --print` on the subscription (see
`RAPITAS_AUX_AI=cli`), so counting a Gemini seat would be the same vote
counted twice. The consequence is that a gate designed around majority voting
has been deciding every October review with one voter.

What that single voter costs, measured over the window where a second opinion
still existed:

| Measure                                                       | Value                            |
| ------------------------------------------------------------- | -------------------------------- |
| Claude FAILs that had ≥1 second opinion                       | n=107                            |
| …of those, ≥1 other juror said PASS                           | **51.4%** (95% CI 41.1–60.7%)    |
| Claude PASSes that had ≥1 second opinion                      | n=233                            |
| …of those, contested by another juror's FAIL                  | 10.7%                            |
| Claude vs Gemini agreement (both judged)                      | 80.1% (n=326)                    |
| Claude vs OpenAI agreement (both judged)                      | 82.0% (n=233)                    |
| Split reviews where FAIL was the **minority**                 | 36 of 53                         |

The asymmetry is the finding: this juror fails diffs others pass 2.7× more
often than the reverse (78 cases vs 29). Under majority voting, 36 of the 53
split reviews would have passed. A panel of one keeps every one of those
fails, and each one costs a repair iteration.

The confidence interval is computed by resampling **reviews**, not juror
pairs; pairs within a review share a diff and a prompt, and resampling them
reports an interval several times too narrow.

## Decision

Seat the jury from **three distinct Claude models** (Opus, Sonnet, Haiku)
whenever only the Claude CLI is reachable. Panel composition moves to a new
pure module, `services/agents/verification/jury-panel.ts`:

- **Not two models.** With two jurors, one harsh voter ties the vote and a tie
  breaks to fail — strictly harsher than the single juror it replaced, which
  is the opposite of what the measurement calls for. Three gives a real
  majority.
- **The implementer's own model is seated last, never dropped.** Dropping it
  would leave a panel of two, with the problem above. Seating it last means a
  different model answers first, which is the same policy the provider
  ordering had.
- **Deduped by the model the CLI actually reaches.** `toCliModel` maps any
  unrecognised model id to Haiku, so two configured ids could otherwise become
  one juror holding a majority by itself. `RAPITAS_JURY_MODELS` overrides the
  panel and is deduped by tier.
- **Cross-vendor behaviour is unchanged** on a host that can really reach three
  vendors. This is a repair for CLI mode, not a redesign.
- **Every juror's model is recorded** in the `adversarial_review` payload
  alongside its verdict, so the contested-fail rate above keeps being
  measurable from production data with no extra calls.

## Consequences

- Reviews now make three model calls where they made one. Jurors are asked
  sequentially by default (`juror-scheduling.ts`, so peak CPU stays at one
  `claude --print`), which raises review latency roughly threefold in the worst
  case; `RAPITAS_JURY_PARALLEL=1` trades that back for peak load. At the
  measured rate of ~8.8 reviews/day this is ~26 subscription calls/day instead
  of ~9, and no paid API usage.
- The measured 51.4% contested-fail rate is a **retrospective proxy**, not a
  flip rate: a disagreement says the verdict was not robust, not which juror
  was right. From this change onward the two are recorded together on live
  traffic, so the rate can be read directly.
- The clean-arm figures from `scripts/judge-precision.ts` carry a selection
  bias that is stated in the script: its cases are diffs this judge already
  passed, so the false-fail rate it reports is a floor.

## Alternatives rejected

- **Leave it as a panel of one.** It is the configuration the module's own
  research basis argues against, and the measurement shows it is the harsh
  direction.
- **Restore paid API jurors for Gemini/OpenAI.** Genuinely heterogeneous, but
  it reintroduces per-call billing for a gate that runs on every verify, and
  the aux-AI design decision (CLI, subscription-only) was taken deliberately.
  Revisit if the contested rate stays high across Claude models — that would
  be evidence that distinct Claude models are not independent enough.
- **Break ties to pass instead.** Cheaper, but it changes the skeptical
  default of the gate on the strength of a proxy measurement.

## How this was verified

- `services/agents/verification/jury-panel.test.ts` — panel size, distinct
  models, distinct labels, implementer ordering, dedupe.
- `adversarial-diff-review.test.ts` — CLI mode asks three distinct models and
  records three real votes with no placeholder seats.
- Mutation check: reducing the CLI panel to one seat turns 7 tests red.
- `scripts/judge-precision.ts` / `judge-precision-scoring.ts` — the standing
  instrument, with a self-check that refuses to report a judge as perfect when
  the scorer is arm-blind.
