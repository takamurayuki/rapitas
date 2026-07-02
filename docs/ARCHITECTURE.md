# Architecture

Rapitas is a hierarchical, AI-augmented task manager delivered as both a web app
and a Tauri desktop app. This document is a high-level map of the system —
**what runs where, and which boundaries matter**. For module-level details,
read the source under each subproject.

> Last reviewed: 2026-07-03

---

## 1. Topology

```
                      ┌────────────────────────┐
                      │  rapitas-desktop       │
                      │  (Tauri 2.x, Rust)     │
                      │  - System WebView      │
                      │  - Backend sidecar     │
                      └───────────┬────────────┘
                                  │ embeds
                                  ▼
┌────────────────────────┐   ┌────────────────────────┐
│  rapitas-frontend      │◄──►  rapitas-backend       │
│  Next.js 16 / React 19 │   │  Bun + Elysia          │
│  Tailwind v4           │   │  Prisma + PostgreSQL   │
│  zustand + SWR         │   │  SSE + Redis           │
│  port 3000             │   │  port 3001             │
└────────────────────────┘   └───────────┬────────────┘
                                         │
                                         ▼
                              ┌────────────────────────┐
                              │  External services     │
                              │  - Anthropic Claude    │
                              │  - OpenAI              │
                              │  - Google Generative AI│
                              │  - GitHub API          │
                              │  - Local LLM (Ollama)  │
                              │  - Playwright (sidecar)│
                              └────────────────────────┘
```

| Process | Owner | Lifecycle | Port |
|---|---|---|---|
| Backend (Elysia) | `rapitas-backend/index.ts` | Always-on; **must not be restarted casually** (see CLAUDE.md §1) | 3001 |
| Frontend (Next.js) | `rapitas-frontend` | Dev: HMR via pnpm; Prod: static export when `TAURI_BUILD=true` | 3000 |
| Desktop shell | `rapitas-desktop/src-tauri` | Spawns backend as a sidecar in production | — |
| PostgreSQL | external | Managed by user / `dev.js` validates connection | 5432 |
| Redis (optional) | external | Cache + realtime | 6379 |

The startup orchestrator is **`rapitas-desktop/scripts/dev.js`**. It performs
zombie-process cleanup, `prisma db push --skip-generate`, `prisma generate`,
and concurrent backend/frontend launch. **Never** run `prisma generate` or
`prisma db push` outside of this script during a live agent session.

---

## 2. Subsystem boundaries

The codebase grew organically and now spans many features. To stay
navigable, treat the following as the canonical module boundaries:

### 2.1 Backend (`rapitas-backend/`)

```
rapitas-backend/
├── routes/         # HTTP route definitions (thin layer)
├── services/       # Business logic + DB queries
├── middleware/     # Auth, CORS, request logging
├── schemas/        # TypeBox schemas for input validation
├── prisma/         # schema/*.prisma (80 models + 1 enum — see §3)
├── utils/          # Cross-cutting helpers
├── workers/        # Background jobs (transcription, screenshot, etc.)
└── tasks/          # Workflow files written by AI agents (research/plan/verify)
```

The **routes → services → prisma** layering is intended to be strict, but
several oversized files violate it (`routes/tasks/tasks.ts` 881 lines,
`services/agents/claude-code/agent-core.ts` 1012 lines). These should be
split per `COMPONENT_SPLITTING_POLICY.md`.

### 2.2 Frontend (`rapitas-frontend/`)

```
rapitas-frontend/src/
├── app/            # Next.js App Router pages (36 top-level routes)
├── components/     # Shared UI components
├── feature/        # Feature folders (calendar, search, tasks, …)
├── hooks/          # Custom React hooks
├── stores/         # zustand stores (global state)
├── contexts/       # React context providers
├── lib/            # Pure utilities, API clients
├── styles/         # Tailwind v4 entry + globals
└── i18n/           # Locale config (catalogs in ../../messages/; full en/ja parity, 3904 keys each)
```

State management split:

- **zustand** — global UI state (theme, filters, modal stacks)
- **SWR** — server data fetching, caching, revalidation
- **React Context** — auth, dark mode, locale

### 2.3 Desktop (`rapitas-desktop/`)

Tauri 2.10 with the system WebView. The Rust shell only does:

1. Spawn the Bun-compiled backend binary as a **sidecar**
2. Load the statically exported frontend (`out/`)
3. Provide native integrations (notifications, file system, autoupdate)

There is **no Tauri command wrapping the API** — frontend talks to the backend
via plain HTTP/SSE on `localhost:3001`.

---

## 3. Data model

`rapitas-backend/prisma/schema/` is a `prismaSchemaFolder` layout (see
[ADR-0006](adr/0006-prisma-schema-folder-split.md)) containing **80 models +
1 enum** across 11 per-domain files plus `_generators.prisma`. Prisma merges
them at generate time. They cluster as follows:

| Sub-domain | Representative models | Notes |
|---|---|---|
| **Core tasks** | `Category`, `Theme`, `Project`, `Milestone`, `Task`, `Comment`, `Label` | Hierarchical: Category → Theme → Project → Task → Subtask |
| **Time tracking** | `TimeEntry`, `PomodoroSession`, `ActivityLog`, `DailyScheduleBlock` | |
| **Learning** | `ExamGoal`, `LearningGoal`, `Habit`, `HabitLog`, `Resource`, `StudyStreak` | |
| **AI orchestration** | `AgentSession`, `AgentExecution`, `AgentExecutionLog`, `AIAgentConfig`, `WorkflowQueueItem`, `OrchestraSession` | Multi-provider (Claude/OpenAI/Gemini/Local) |
| **Knowledge / memory** | `KnowledgeEntry`, `KnowledgeGraphNode`, `KnowledgeGraphEdge`, `EpisodeMemory`, `MemoryJournalEntry`, `ConsolidationRun` | Long-term agent memory |
| **GitHub integration** | `GitHubIntegration`, `GitHubPullRequest`, `GitHubPRReview`, `GitHubIssue`, `GitCommit` | Bidirectional sync (planned) |
| **Self-improvement** | `Experiment`, `Hypothesis`, `CriticReview`, `LearningPattern`, `WorkflowLearningRecord`, `PromptEvolution` | Research/experimental |
| **System** | `User`, `UserSession`, `UserSettings`, `Notification`, `ApprovalRequest` | Identity, settings, approvals |

> Layout:
>
> ```
> rapitas-backend/prisma/schema/
> ├── _generators.prisma   # generator + datasource
> ├── core.prisma          # 11 models (Category, Theme, Project, Milestone, Task, …)
> ├── time.prisma          # 4 models (TimeEntry, PomodoroSession, …)
> ├── learning.prisma      # 6 models (ExamGoal, Habit, Resource, …)
> ├── behavior.prisma      # 5 models (UserBehavior, TaskPattern, …)
> ├── agents.prisma        # 11 models (AgentSession, AgentExecution, …)
> ├── workflow.prisma      # 7 models (OrchestraSession, WorkflowQueueItem, …)
> ├── memory.prisma        # 12 models (KnowledgeEntry, KnowledgeGraph*, …)
> ├── experiments.prisma   # 7 models (Experiment, Hypothesis, …)
> ├── github.prisma        # 8 models (GitHubIntegration, GitHubPullRequest, …)
> ├── system.prisma        # 7 models (User, UserSession, …)
> └── schedule.prisma      # 2 models + 1 enum (ScheduleEvent, PaidLeaveBalance)
> ```

---

## 4. Runtime considerations

### Three runtimes coexist

- **Bun** for `rapitas-backend` (hot-reload + standalone compile for sidecar)
- **pnpm** for `rapitas-frontend` and `rapitas-desktop` (Next.js + Tauri ecosystem)
- **npm** for the root workspace (legacy; planned migration — see ADR 0001)

This is a known source of friction. The mitigation is in
`scripts/preflight-check.cjs`, which validates all three are installed before
`npm run dev`.

### AI agent self-modification loop

The backend exposes a **workflow API** (`/workflow/tasks/{taskId}/files/...`)
that AI agents — including Claude Code itself — call to write
`research.md`, `plan.md`, and `verify.md` into `rapitas-backend/tasks/`.
**This is why CLAUDE.md forbids restarting the backend during a session**:
the agent would lose its own connection.

### Realtime

The live transport is **Server-Sent Events (SSE)**, not WebSocket. The
backend streams events from `rapitas-backend/routes/system/sse.ts` /
`services/communication/realtime-service.ts`
(`GET /events/stream`, `GET /events/subscribe/:channel`); the frontend
consumes them via `hooks/common/useSse.ts` and a shared
`lib/sse/shared-event-source.ts` (one `EventSource` per channel, shared
across components to stay under the browser's per-origin connection cap).

A native-`ws` `WebSocketManager`
(`rapitas-backend/services/communication/websocket-service.ts`, with its own
tests) also exists in the codebase, but it is **not mounted** in the
running backend entry point (`rapitas-backend/index.ts`) — its only
consumer is `index-optimized.ts`, which no `dev`/`start` script runs. So in
practice there is one live transport (SSE); the `ws` service is dead code
today, not a second active transport. There is **no** Socket.IO anywhere in
the repo — see [ADR-0005](adr/0005-realtime-transport.md) for that history.

---

## 5. Build & deploy

### Development

```bash
cd rapitas-desktop && node scripts/dev.js
```

or, web only:

```bash
npm run dev
```

### Production (desktop)

GitHub Actions (`.github/workflows/tauri-build.yml`) builds 4 targets:

- `x86_64-pc-windows-msvc`
- `x86_64-apple-darwin`
- `aarch64-apple-darwin`
- `x86_64-unknown-linux-gnu`

The backend is compiled to a standalone binary via `bun build --compile` and
placed in `rapitas-desktop/src-tauri/binaries/` as a Tauri sidecar. Tauri then
bundles `.exe`/`.msi`/`.dmg`/`.deb`/`.rpm` artifacts. Releases are triggered
by tags matching `v*`.

### Web

```bash
npm run build:web
```

Switches Prisma datasource via `scripts/switch-to-postgres.cjs`, then runs
the standard Next.js build.

---

## 6. Quality gates

| Gate | Workflow | Status |
|---|---|---|
| Backend tests | `test-lint.yml` | Active (no coverage gate) |
| Frontend tests | `test-lint.yml` | Active (5 named test files only, not the full suite); coverage thresholds configured in `vitest.config.ts` (lines 30% / branches 25% / functions 28% / statements 30%) but CI runs plain `vitest run`, not `--coverage`, so the thresholds are **not currently enforced** |
| Type check | `test-lint.yml` | `tsc --noEmit` for both apps |
| Lint / format | `test-lint.yml` | ESLint + Prettier |
| Rust clippy | `test-lint.yml` | `cargo clippy -- -D warnings` |
| Trivy | `security-scan.yml` | CRITICAL/HIGH on filesystem |
| CodeQL | `security-scan.yml` | JS/TS |
| `cargo audit` | `security-scan.yml` | Tauri dependencies |
| `npm audit` | `security-scan.yml` | Frontend + desktop |
| Gitleaks | `gitleaks.yml` | Secret scanning |
| actionlint | `actionlint.yml` | Workflow YAML lint |
| Knip | `knip.yml` | Advisory (unused exports/deps) |
| Bundle size | `bundle-size.yml` | Advisory (per-chunk + total budget) |
| Version sync | `version-check.yml` | Hard fail if manifests drift |
| Tauri build | `tauri-build.yml` | 4 platforms; tag-driven release |

See also: `.github/CI_CD_SETUP.md`.

---

## 7. Open architectural questions

1. **Schema-first vs code-first** for Prisma — currently `db push` based, no
   migration history. Must move to `prisma migrate` before public release.
2. **Module ownership** — 80 models split across 11 per-domain files (ADR-0006)
   still lacks CODEOWNERS-by-domain, so cross-domain ownership is unclear.
3. **AI agent isolation** — agents currently share the same DB. Multi-tenant
   isolation (per-user agents) is unclear.
4. **Dead `ws` service** — `services/communication/websocket-service.ts` is
   fully implemented and tested but not mounted in the live `index.ts`; either
   wire it up for a real use case or delete it so it stops looking active.
5. **Three runtimes** — see ADR 0001.

---

## See also

- `CLAUDE.md` — agent operating constraints (section 1 is non-negotiable)
- `docs/adr/` — architecture decision records
- `COMPONENT_SPLITTING_POLICY.md` — file/dir size limits
- `FOLDER_ORGANIZATION_POLICY.md` — directory layout rules
