# 0002. Stepwise coverage gate instead of a single 80% target

- Status: accepted
- Date: 2026-04-08
- Deciders: @takamurayuki

## Context

`CLAUDE.md` §3 specifies a hard target of **≥ 80% test coverage for all new
code**. This is a reasonable long-term goal, but the actual repository state
on 2026-04-08 is:

- **150 test files** across `~1,281` source files (≈ 12% file-level density)
- The frontend CI gate in `.github/workflows/test-lint.yml` was set to
  `lines < 10` — effectively a no-op
- The backend CI runs `bun test` but **does not measure coverage at all**

Setting the gate to 80% immediately would produce a permanently red `develop`
branch. Setting it to 0 (or 10) communicates that the target is aspirational
only. Neither is useful.

A stepwise ratchet — raising the threshold over time as new code lands with
tests — gives the team a credible path from current state to the
CLAUDE.md target without blocking shipping.

## Decision

Adopt a **two-axis stepwise gate**:

### Axis 1 — Frontend line coverage (already gated)

Raise the `THRESHOLD` constant in `test-lint.yml` on the following schedule.
Each step requires the previous one to have been green for at least two weeks
on `develop`.

| Step | Threshold | Earliest date |
|---|---|---|
| 0 (current) | 15% | 2026-04-08 |
| 1 | 30% | 2026-04-22 |
| 2 | 50% | 2026-05-20 |
| 3 | 70% | 2026-07-01 |
| 4 (CLAUDE.md target) | 80% | 2026-08-15 |

If a step fails because real coverage dropped (rather than the ratchet being
too aggressive), the response is to **add tests for the affected module**, not
to lower the threshold.

### Axis 2 — Backend line coverage (not yet gated)

1. **Phase A** (within 2 weeks of this ADR): Add a CI step that runs
   `bun test --coverage` and **prints** the result without gating.
2. **Phase B** (after observing Phase A for 2 weeks): Introduce a hard gate
   starting at **the observed value rounded down to the nearest 5%**.
3. **Phase C** (ongoing): Follow the same ratchet schedule as the frontend,
   shifted by the start date.

### Branches and modules
The gate applies to **the whole codebase**, not per-module. Module-level
gates are tempting but produce brittle CI; instead, prioritize testing in
order of business risk:
1. `services/task/`, `routes/tasks/`
2. `services/workflow/`
3. `services/agents/` (especially the orchestrator)
4. `lib/` and `utils/` (pure functions are cheapest to test)
5. UI components (last — highest churn, lowest stability)

## Alternatives considered

### A. Hard 80% gate from day one
- Pros: Matches CLAUDE.md verbatim. No ambiguity.
- Cons: Permanent red CI. Encourages disabling tests or marking files as
  excluded just to get a PR through.
- Verdict: Rejected.

### B. Per-module gates with file-level allowlists
- Pros: Targets the gate at the modules that matter most.
- Cons: Allowlist files become a bottleneck and rot quickly. Coverage tools
  vary in how they support per-file thresholds.
- Verdict: Rejected — added complexity not worth the targeting precision.

### C. Coverage-as-a-comment-only (no gate)
- Pros: Zero false positives.
- Cons: No forcing function. Coverage will not improve on its own.
- Verdict: Rejected — the whole point is to ratchet upward.

## Consequences

### Positive
- Clear, dated commitments make the ratchet auditable.
- New code naturally needs tests once existing coverage is close to the
  threshold.
- Backend coverage becomes visible (currently invisible).

### Negative
- Two-week observation periods slow down the ramp.
- Backend "Phase A" requires CI changes that aren't done yet.
- The schedule is calendar-driven; if the team is small, it may need to slip.

### Neutral
- The CLAUDE.md target (80%) does not change — only the path to it.

## Follow-ups

- [ ] 2026-04-22: Raise frontend threshold to 30 (`test-lint.yml` line ~120)
- [ ] 2026-04-22: Land backend coverage Phase A (print-only)
- [ ] 2026-05-06: Land backend coverage Phase B (gated at observed value)
- [ ] 2026-05-20: Raise frontend threshold to 50
- [ ] 2026-07-01: Raise frontend threshold to 70
- [ ] 2026-08-15: Raise frontend threshold to 80 — close out this ADR
- [ ] If any step needs to slip, append a **revision note** to this ADR
      (do not silently change the dates)
