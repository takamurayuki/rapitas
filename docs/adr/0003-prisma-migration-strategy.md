# 0003. Move from `prisma db push` to `prisma migrate` before public release

- Status: accepted
- Date: 2026-04-08
- Deciders: @takamurayuki

## Context

`rapitas-backend` currently uses **`prisma db push`** as its only schema
synchronization mechanism. The startup script
(`rapitas-desktop/scripts/dev.js`) runs `prisma db push --skip-generate` on
every dev launch, and CI workflows do the same against a throwaway PostgreSQL
service container.

There is no `migrations/` directory under version control. In fact,
`.gitignore` explicitly excludes `migrations`, so even if `prisma migrate`
were run locally, the SQL files would not be committed.

This is acceptable today because:
- The product is pre-release and there are no production users
- The schema (71 models, 1426 lines) is still in flux
- Iterating on the schema with `db push` is faster than authoring migrations

It will become unacceptable as soon as **any of these become true**:
1. A public release ships and users start storing real data
2. The product is deployed to a long-running staging environment
3. More than one developer needs to share schema changes via PR

`db push` cannot be used in those scenarios because:
- It does not version-control the sequence of changes
- It cannot represent destructive operations safely (column drops, type changes)
- It cannot back-fill data during a transition
- It cannot be reviewed in a PR — the SQL is invisible

## Decision

We commit to migrating to **`prisma migrate`** before the first public release,
on the following plan:

### Phase 1 — Stabilize the schema (now)
- Continue using `db push` for day-to-day iteration
- **Freeze** breaking schema changes (column drops, type changes, table renames)
  during the two weeks immediately preceding Phase 2
- Document the schema freeze in `MEMORY.md` and the team channel

### Phase 2 — Baseline migration (target: before v1.1.0)
1. Drop the development database completely
2. Run `prisma migrate dev --name baseline` to generate `migrations/0001_baseline/`
3. **Remove `migrations` from `.gitignore`**
4. Commit the baseline migration as a single PR titled
   `chore(prisma): introduce migration baseline`
5. Update `rapitas-desktop/scripts/dev.js` to call `prisma migrate deploy`
   instead of `prisma db push`
6. Update CI workflows in `.github/workflows/test-lint.yml` and
   `tauri-build.yml` similarly
7. Update `CLAUDE.md` §1: replace the "never run `prisma generate` / `db push`"
   warning with "never run `prisma migrate` manually" (same logic, new command)

### Phase 3 — Migration discipline (ongoing)
- Every PR that touches `schema.prisma` must include a generated migration
- Migration files are reviewed alongside the schema change
- Destructive migrations require an ADR or a PR-level explanation

### Phase 4 — Production safety nets (target: before v2.0.0)
- Add `prisma migrate diff` as a CI check that compares the migration history
  against the schema and fails if they drift
- Add a pre-merge dry-run against a snapshot of staging data
- Document a rollback procedure for each destructive migration

## Alternatives considered

### A. Keep `db push` indefinitely
- Pros: Fastest iteration. Zero migration files to maintain.
- Cons: Breaks the moment any user has data. No PR reviewability.
- Verdict: Rejected — only viable while pre-release.

### B. Switch to `prisma migrate` immediately
- Pros: Eliminates the schema-vs-migration drift risk early.
- Cons: The schema is still churning daily. We would author dozens of
  throwaway migrations before the schema stabilizes.
- Verdict: Rejected — premature.

### C. Use a non-Prisma migration tool (Atlas, Sqitch, raw SQL)
- Pros: More expressive than Prisma's migration engine for complex changes.
- Cons: Loses Prisma's introspection and dual-source-of-truth guarantee.
  Adds a second tool to the stack.
- Verdict: Rejected — complexity not worth it for a single-DB product.

### D. Adopt `prisma migrate` only for the production deploy path
- Pros: Keeps `db push` ergonomics in dev.
- Cons: Two divergent schema mechanisms in the same repo. Bugs hide in the
  delta.
- Verdict: Rejected — single source of truth is non-negotiable.

## Consequences

### Positive
- Production schema changes become reviewable, auditable, and rollback-able.
- The path from "AI agent generates schema change" to "merged migration" is
  explicit, not implicit.
- CI can validate migration correctness (Phase 4).

### Negative
- Phase 2 is a one-time disruption — every developer must drop their dev DB.
- AI agents (per CLAUDE.md) currently never touch migrations; the workflow
  must be updated to permit `prisma migrate dev` runs and to recognize
  generated migration files.
- Faster iteration in Phase 1 means more "wasted" schema designs that the
  baseline will not preserve.

### Neutral
- The 71-model `schema.prisma` may benefit from being split into a
  `prismaSchemaFolder` (Prisma 5+ preview) **before** Phase 2, so the
  baseline migration is generated against a cleaner source. This is tracked
  separately in `project-improve.md` and is **not** a hard prerequisite.

## Follow-ups

- [ ] Set a target release version that triggers Phase 2 (e.g. `v1.1.0`)
- [ ] Decide whether to split `schema.prisma` into a folder before Phase 2
- [ ] Draft the `migrations` removal PR for `.gitignore`
- [ ] Update CLAUDE.md §1 wording at Phase 2 cutover
- [ ] Add `prisma migrate diff` CI step at Phase 4
- [ ] Document the rollback procedure template
