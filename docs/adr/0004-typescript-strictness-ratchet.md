# 0004. TypeScript strictness ratchet

- Status: accepted
- Date: 2026-04-08
- Deciders: @takamurayuki

## Context

Both `rapitas-backend/tsconfig.json` and `rapitas-frontend/tsconfig.json`
already enable `"strict": true`, which is the table-stakes baseline. Beyond
that, **none** of the optional strictness flags are enabled:

| Flag | Backend | Frontend |
|---|---|---|
| `strict` | ✓ | ✓ |
| `noImplicitOverride` | ✗ | ✗ |
| `noFallthroughCasesInSwitch` | ✗ | ✗ |
| `noUnusedLocals` | ✗ | ✗ |
| `noUnusedParameters` | ✗ | ✗ |
| `noImplicitReturns` | ✗ | ✗ |
| `exactOptionalPropertyTypes` | ✗ | ✗ |
| `noUncheckedIndexedAccess` | ✗ | ✗ |
| `forceConsistentCasingInFileNames` | ✗ (default-on in TS 5+) | ✗ (same) |

`CLAUDE.md` §3 forbids the `any` type ("If unavoidable, add `// HACK(agent):
reason`"), but the type checker does not enforce this — the rule is
review-only. The current `check-todos.cjs` baseline reports **14 HACK
markers**, most of them `any` casts in routes/services. That's the
observable cost of not having stricter type rules.

Turning every flag on at once would generate hundreds of errors in a single
PR — unreviewable, and likely to be reverted.

## Decision

Adopt a **stepwise strictness ratchet**, mirroring the coverage ratchet in
[ADR-0002](./0002-coverage-gate-staging.md). Each flag is enabled in
**backend first** (smaller surface, fewer files), then **frontend** after a
two-week observation window.

Source of truth for shared settings is the new
[`tsconfig.base.json`](../../tsconfig.base.json) at the repo root. The
subproject tsconfigs do **not** extend it yet — wiring `extends` is part of
the rollout (Step 0).

### Rollout schedule

| Step | Flag | Backend earliest | Frontend earliest |
|---|---|---|---|
| 0 | Wire subprojects to `extends: ../tsconfig.base.json` | 2026-04-22 | 2026-04-22 |
| 1 | `noImplicitOverride` + `noFallthroughCasesInSwitch` | 2026-04-29 | 2026-05-13 |
| 2 | `noUnusedLocals` + `noUnusedParameters` | 2026-05-13 | 2026-05-27 |
| 3 | `noImplicitReturns` | 2026-05-27 | 2026-06-10 |
| 4 | `noUncheckedIndexedAccess` | 2026-06-10 | 2026-06-24 |
| 5 | `exactOptionalPropertyTypes` | 2026-06-24 | 2026-07-08 |

Each step lands as **one PR per subproject** that:
1. Enables the flag in the relevant tsconfig
2. Fixes (not silences) the resulting errors
3. Updates this ADR's "Status of each flag" table

### Hard rules during the ratchet

- **Do not silence errors with `// @ts-ignore` or `// @ts-expect-error`**
  to land a step. If a fix is too invasive, defer the step.
- **Do not lower the bar by removing a flag once enabled.** Reverting a
  step requires a follow-up ADR.
- **Bundle all tsconfig drift fixes into the step PR.** Don't mix unrelated
  cleanup.

### `any` and `HACK` baseline

Independent of the flag ratchet, we set a regression baseline using
`scripts/check-todos.cjs`:

- **HACK count today: 14** (measured 2026-04-08)
- **CI hard ceiling: HACK ≤ 14** — adding a new HACK without removing
  another fails CI
- Each step that lands a strictness flag must reduce the HACK count or
  hold it flat — never raise it

Wire the ceiling via:
```bash
node scripts/check-todos.cjs --max-hack 14 --max-fixme 1
```

## Alternatives considered

### A. Enable everything in one PR
- Pros: Done in one shot. No multi-month tracking.
- Cons: Hundreds of errors. Unreviewable. High revert risk.
- Verdict: Rejected.

### B. Opt-in per file via `// @ts-strict`
- Pros: Lets motivated authors push ahead without a global gate.
- Cons: TypeScript has no built-in per-file strict mode. Workarounds (file
  globs in separate `tsconfig.strict.json`) double maintenance.
- Verdict: Rejected.

### C. Tighten only the backend; leave the frontend alone
- Pros: Backend is the higher-stakes surface (data integrity).
- Cons: Frontend bugs ship to users; declining to fix them is asymmetric
  in the wrong direction.
- Verdict: Rejected.

### D. Adopt a third-party ruleset (e.g. `tsconfig/strictest`)
- Pros: Pre-curated.
- Cons: Hides the per-flag reasoning we need for the ratchet narrative.
- Verdict: Rejected — we can copy the same flags individually with
  visible commit history.

## Consequences

### Positive
- A clear, dated path from "strict-only" to "strictest" without permanent
  red CI.
- HACK ceiling forces refactoring of the messiest parts of the codebase
  (routes/system/search, services/communication/webhook-notification, etc.)
- Future contributors find a single source of truth in `tsconfig.base.json`
  rather than two divergent tsconfigs.

### Negative
- Six steps × 2 weeks = at least 3 months of overhead per subproject.
- Step-PRs may conflict with feature work in the same files.
- The `extends` migration in Step 0 must preserve every existing field of
  each subproject's tsconfig — manual review required.

### Neutral
- The CLAUDE.md "no any" rule remains review-enforced; the type checker
  doesn't help until Step 4 (`noUncheckedIndexedAccess`) at the earliest.

## Status of each flag

(Update this table as steps land. Mark ✓ when active in the listed subproject.)

| Flag | Backend | Frontend |
|---|---|---|
| `strict` | ✓ | ✓ |
| `forceConsistentCasingInFileNames` | (default in TS 5+) | (default in TS 5+) |
| `noImplicitOverride` | — | — |
| `noFallthroughCasesInSwitch` | — | — |
| `noUnusedLocals` | — | — |
| `noUnusedParameters` | — | — |
| `noImplicitReturns` | — | — |
| `noUncheckedIndexedAccess` | — | — |
| `exactOptionalPropertyTypes` | — | — |

## Follow-ups

- [ ] 2026-04-22: Land Step 0 (wire `extends: ../tsconfig.base.json`)
- [ ] 2026-04-29: Land Step 1 backend
- [ ] 2026-05-13: Land Step 1 frontend + Step 2 backend
- [ ] 2026-05-27: Land Step 2 frontend + Step 3 backend
- [ ] 2026-06-10: Land Step 3 frontend + Step 4 backend
- [ ] 2026-06-24: Land Step 4 frontend + Step 5 backend
- [ ] 2026-07-08: Land Step 5 frontend — close out this ADR
- [ ] When closing: update CLAUDE.md §3 to point at the ADR for the
      strictness flag list
