# 0006. Split `schema.prisma` into a `prismaSchemaFolder`

- Status: accepted — **implemented 2026-04-09**
- Date: 2026-04-08
- Deciders: @takamurayuki

## Context

`rapitas-backend/prisma/schema.prisma` currently contains **71 models** in a
single 1426-line file. The models cluster into clear sub-domains
(documented in `docs/ARCHITECTURE.md` §3):

| Sub-domain | Approx. models |
|---|---|
| Core tasks | 7 |
| Time tracking | 4 |
| Learning | 7 |
| AI orchestration | 6 |
| Knowledge / memory | 6 |
| GitHub integration | 5 |
| Self-improvement / experiments | 7 |
| System | 5 |
| Other (settings, schedule, paid leave, …) | ~24 |

The 1426-line monolith causes several daily problems:

1. **Editor latency** — TypeScript server occasionally lags on autocomplete
   inside Prisma model references (see `docs/PERFORMANCE.md` §2.1)
2. **`prisma generate` time** — 5–10s on first run, slower on rebuilds
3. **Diff readability** — even a one-field change shows up in the same
   massive file, making code review harder than it needs to be
4. **CODEOWNERS impossible at the model level** — every schema change is
   owned by "whoever touched the file last"
5. **Cognitive scaling** — adding the 72nd model means scrolling past 71
   others to find a good spot

Prisma 5.15+ supports the `prismaSchemaFolder` preview feature, which lets
the schema live in **multiple `.prisma` files inside a folder**, with all
the same semantics as a single file. The Prisma CLI merges them at runtime.

## Decision

We adopt `prismaSchemaFolder` and split `schema.prisma` into one file per
sub-domain, **before** Phase 2 of [ADR-0003](./0003-prisma-migration-strategy.md)
(the move from `db push` to `migrate`). The split must land first so that
the baseline migration is generated against the cleaner source.

### Target layout

```
rapitas-backend/prisma/
├── schema/
│   ├── _generators.prisma     # generator client + datasource db
│   ├── core.prisma            # Category, Theme, Project, Milestone, Task, Comment, Label
│   ├── time.prisma            # TimeEntry, PomodoroSession, ActivityLog, DailyScheduleBlock
│   ├── learning.prisma        # ExamGoal, LearningGoal, Habit, HabitLog, Resource, Flashcard*
│   ├── agents.prisma          # AgentSession, AgentExecution*, AIAgentConfig, OrchestraSession
│   ├── memory.prisma          # KnowledgeEntry, KnowledgeGraph*, EpisodeMemory, MemoryJournalEntry
│   ├── github.prisma          # GitHubIntegration, GitHubPullRequest, GitHubIssue, GitCommit
│   ├── experiments.prisma     # Experiment, Hypothesis, CriticReview, LearningPattern
│   ├── system.prisma          # User, UserSession, UserSettings, Notification, ApprovalRequest
│   └── misc.prisma            # PaidLeaveBalance, ScheduleEvent, FavoriteDirectory, …
└── migrations/                # populated only after ADR-0003 Phase 2
```

`_generators.prisma` keeps the `generator client` and `datasource db`
blocks isolated so they're easy to find. The leading underscore sorts it
to the top in any directory listing.

### Sub-domain assignment rule

A model lives in the file **whose name describes its primary purpose**, not
the file containing the model it most often joins to. For example:

- `Comment` lives in `core.prisma` (it's a task-management primitive),
  even though it has FKs into `system.prisma:User`.
- `AgentExecutionLog` lives in `agents.prisma`, not in `system.prisma`,
  even though it has a `userId`.

When in doubt, ask: "If we deleted this whole sub-domain, would this model
go with it?"

### Enums and shared types

Enums used by **one** model live in that model's file. Enums used by
**two or more** files live in `_enums.prisma` to avoid arbitrary cross-file
dependencies.

### Configuration

In `rapitas-backend/prisma/schema/_generators.prisma`:

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["prismaSchemaFolder"]
}
```

In `rapitas-backend/package.json` no script changes are required —
`prisma generate`, `prisma db push`, and `prisma migrate` all auto-detect
the folder layout when `previewFeatures` includes `prismaSchemaFolder`.

## Rollout

This is a **single PR**, not a multi-step ratchet. The cost of doing it
incrementally (mixed monolith + folder, intermediate broken commits) is
worse than the cost of one carefully reviewed PR.

### Steps in that PR

1. Enable `prismaSchemaFolder` in the existing `schema.prisma`'s generator
2. Create `prisma/schema/` and the empty per-domain files
3. Move models out of `schema.prisma` in dependency order: enums first,
   then leaf models, then models with FKs
4. Delete the now-empty `schema.prisma`
5. Run `prisma format` against the folder — verify it accepts the layout
6. Run `prisma generate` — verify the client builds with the same surface
7. Run `prisma db push` against a throwaway local DB — verify zero diff
8. Run `bun test` — verify nothing broke
9. Update `docs/ARCHITECTURE.md` §3 to reference the folder layout
10. Update `CLAUDE.md` §1 wording where it mentions `schema.prisma`

### Acceptance criteria for the PR

- [ ] Every model from the original `schema.prisma` is present in exactly
      one new file
- [ ] `prisma generate` succeeds with `previewFeatures = ["prismaSchemaFolder"]`
- [ ] Diff against the dev DB is zero (`prisma db push --accept-data-loss=false`
      reports "Already in sync")
- [ ] All existing tests pass
- [ ] No file in `schema/` exceeds 400 lines (soft self-imposed limit)
- [ ] `_generators.prisma` and `_enums.prisma` exist (even if `_enums.prisma`
      is initially empty)

## Alternatives considered

### A. Leave the monolith alone
- Pros: Zero risk. No cross-file dependencies to worry about.
- Cons: Editor lag and reviewer pain compound as more models land. Blocks
  ADR-0003 Phase 2 from being clean.
- Verdict: Rejected.

### B. Split by **layer** (enums / models / relations) instead of by domain
- Pros: Mechanical, less judgement required.
- Cons: Layer-based splits separate things that change together. Adding a
  new feature would touch all three files instead of one.
- Verdict: Rejected.

### C. Split incrementally (one domain per PR)
- Pros: Smaller PRs.
- Cons: Intermediate states have a half-monolith and a half-folder, which
  Prisma does not support cleanly. Each intermediate PR is broken until the
  next one lands.
- Verdict: Rejected — incrementalism doesn't fit Prisma's all-or-nothing
  schema model.

### D. Switch to a non-Prisma tool that supports modular schemas natively
- Pros: Drizzle, Atlas, etc. have first-class multi-file schemas.
- Cons: Massive migration cost. Loses the Prisma client TypeScript
  ergonomics that the entire backend relies on.
- Verdict: Rejected — out of scope.

## Consequences

### Positive
- Each sub-domain becomes navigable in isolation.
- CODEOWNERS can route schema PRs to per-domain owners (when team grows).
- ADR-0003 Phase 2 baseline migration is generated against a cleaner source.
- Editor / `prisma generate` performance improves (per Prisma's own
  benchmarks for the folder feature).

### Negative
- ~~`prismaSchemaFolder` is still a **preview feature** as of Prisma 6.x.~~
  **Update 2026-04-10**: the feature graduated to GA in Prisma 6.x. The
  `previewFeatures = ["prismaSchemaFolder"]` line was removed from
  `_generators.prisma` because keeping it triggers a deprecation warning
  on every CLI invocation.
- The PR will be large (one file in, ~10 files out). It must be reviewed
  carefully.
- AI agents that grep for `schema.prisma` (including Claude Code, per
  CLAUDE.md §1) need to learn the new path. CLAUDE.md must be updated in
  the same PR.

### Neutral
- This decision is independent of ADR-0003 (migration strategy) and
  ADR-0004 (TS strictness). The three can land in any order, but the
  recommended order is: this ADR → ADR-0003 → ADR-0004 step 0.

## Follow-ups

- [x] Split executed via `scripts/split-prisma-schema.cjs` (2026-04-09)
- [x] Update `docs/ARCHITECTURE.md` §3 with the new layout (2026-04-09)
- [x] Update `docs/PERFORMANCE.md` §2.1 — mark monolith resolved (2026-04-09)
- [x] Update CLAUDE.md §1 wording — point at `prisma/schema/` folder (2026-04-09)
- [ ] User: restart dev server, verify `prisma generate` succeeds against
      the new layout, run `bun test` in rapitas-backend
- [ ] User: re-measure `prisma generate` runtime and editor autocomplete
      latency, update `docs/PERFORMANCE.md` §1 targets table
- [ ] After two weeks of stable operation, delete
      `scripts/split-prisma-schema.cjs` (one-shot tool, no further use)
