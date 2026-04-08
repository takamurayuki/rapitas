# 0001. Three runtimes (npm + pnpm + bun) coexistence

- Status: accepted
- Date: 2026-04-08
- Deciders: @takamurayuki

## Context

The repository currently uses **three different JavaScript runtimes / package
managers** in parallel:

| Subproject | Runtime | Package manager | Lockfile |
|---|---|---|---|
| Root (`/`) | Node.js | npm | `package-lock.json` (and stray `pnpm-lock.yaml`) |
| `rapitas-backend/` | Bun | bun | `bun.lock` + `pnpm-workspace.yaml` |
| `rapitas-frontend/` | Node.js (build) / Bun (test) | pnpm | `pnpm-lock.yaml` + `bun.lock` |
| `rapitas-desktop/` | Node.js | pnpm | `pnpm-lock.yaml` + `bun.lock` |

This was not a single deliberate choice — each subproject picked the runtime
that best fit its toolchain at the time it was created. The current state has
two visible problems:

1. **Cognitive load** for new contributors who must install all three.
2. **Lockfile drift risk** — `package-lock.json` and `pnpm-lock.yaml` both
   live at the repo root, and `bun.lock` files appear in pnpm projects because
   tests use `bun test`.

A first attempt to clean this up failed because:
- Bun is **required** for `rapitas-backend` (Elysia is Bun-first; the standalone
  `bun build --compile` produces the Tauri sidecar binary in CI).
- pnpm is **required** for `rapitas-desktop` (Tauri's CLI integrations and the
  Next.js export pipeline are validated with pnpm).
- The root `package.json` exists primarily to coordinate `concurrently`,
  `husky`, `lint-staged`, and `commitlint` — none of which need a heavyweight
  package manager.

## Decision

We accept the three-runtime split **as the current state** and codify the
following rules to keep it manageable:

1. **Each subproject owns its package manager.** Do not run `pnpm` inside
   `rapitas-backend/`, do not run `bun install` at the root, etc.
2. **The root uses npm**, but only for dev tooling (commitlint, husky,
   concurrently). It does not bundle or build anything.
3. **`scripts/preflight-check.cjs`** must validate that all three runtimes
   are installed before `npm run dev` proceeds.
4. **`.nvmrc`** pins the Node.js major version (currently 20) to match CI.
5. **Stray lockfiles** (e.g. `bun.lock` in pnpm projects, `pnpm-lock.yaml` at
   the root) should be removed when next touched.
6. **No further runtimes** without a new ADR superseding this one.

## Alternatives considered

### A. Unify on pnpm everywhere
- Pros: Single lockfile format, well-supported workspaces, fewer surprises.
- Cons: Loses Bun's `--compile` step that produces the Tauri sidecar binary;
  `bun test` is significantly faster than vitest for the backend's
  current test suite.
- Verdict: Rejected — the build pipeline depends on Bun's compile output.

### B. Unify on Bun everywhere
- Pros: Single runtime, fastest install, zero npm/pnpm fallback.
- Cons: Bun + Playwright pipe protocol hangs on Windows
  ([oven-sh/bun#23826](https://github.com/oven-sh/bun/issues/23826), already
  documented in MEMORY.md). Tauri's CLI validation under Bun is incomplete.
  Next.js 16 + Bun integration still has rough edges.
- Verdict: Rejected — Windows compatibility is a hard requirement.

### C. Drop the root `package.json` entirely
- Pros: Eliminates the npm dependency.
- Cons: Loses cross-project orchestration (`npm run dev`, `npm run install:all`,
  husky setup). Each subproject would need duplicated setup steps.
- Verdict: Rejected — orchestration value > the cost of one extra runtime.

## Consequences

### Positive
- Honest documentation of why three runtimes exist; no more "we should fix
  this someday" hand-waving.
- New contributors get a single canonical answer.
- Each subproject can adopt runtime-specific optimizations without
  cross-project negotiation.

### Negative
- Continued install overhead (3 toolchains).
- Dependabot must run 5 ecosystem updates (root npm, backend npm, frontend
  npm, desktop npm, cargo) instead of one — already configured in
  `.github/dependabot.yml`.
- CI workflows must `setup-node` AND `setup-bun` in most jobs.

### Neutral
- The root `package.json` remains a "tool launcher", not an app manifest.
- Lockfile cleanup is opportunistic, not mandatory.

## Follow-ups

- [ ] Remove stray `pnpm-lock.yaml` from the repo root once root tooling is
      verified to work without it
- [ ] Remove stray `bun.lock` files from `rapitas-frontend/` and
      `rapitas-desktop/` after confirming pnpm installs are sufficient
- [ ] Document the runtime split prominently in `README.md` (currently only
      mentioned in passing)
- [ ] Re-evaluate this ADR if Next.js 16 + Bun reaches GA-quality on Windows
