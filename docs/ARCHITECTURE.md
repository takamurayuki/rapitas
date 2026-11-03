# Architecture

Rapitas is a hierarchical, AI-augmented task manager delivered as both a web app
and a Tauri desktop app. This document is a high-level map of the system —
**what runs where, and which boundaries matter**. For module-level details,
read the source under each subproject.

> Last reviewed: 2026-11-03. Counts below are approximate snapshots as of that
> date — the source tree is authoritative.

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
│  Tailwind v4           │   │  Prisma: PostgreSQL    │
│  zustand + SWR         │   │   (web) / SQLite (desk)│
│                        │   │  SSE                   │
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
| PostgreSQL | external | Web build only; managed by the user | 5432 |
| SQLite | file | Desktop build. Dev: `rapitas-desktop/.data/rapitas-dev.db` (set by `dev.js`); release: `rapitas.db` in the Tauri app data dir (`resolve_database_url` in `rapitas-desktop/src-tauri/src/release.rs`) | — |
| Redis (optional) | external | Only used by `rapitas-backend/services/core/cache-service.ts` when `NODE_ENV=production` (`REDIS_URL`) | 6379 |

The desktop dev orchestrator is **`rapitas-desktop/scripts/dev.js`** (SQLite).
It pins the primary branch, cleans up stale rapitas processes on 3001/3000,
regenerates the SQLite Prisma client + init SQL (`bun run db:prepare:sqlite`,
cached by schema hash), then launches the backend (`bun run dev:stable`) and
the frontend. The backend applies the init SQL to the SQLite DB on boot
(`rapitas-backend/config/desktop-sqlite.ts`). The web dev entry
(`cd rapitas-backend && bun run dev`, i.e. `scripts/dev.ts`) instead runs
`prisma db push --skip-generate` + `prisma generate` via
`rapitas-backend/scripts/dev/prisma-sync.ts`. **Never** run `prisma generate`
or `prisma db push` by hand during a live agent session.

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
├── prisma/         # schema/*.prisma (about 100 models — see §3); schema.desktop/ is generated
├── generated/      # Prisma clients (prisma-postgres / prisma-sqlite), gitignored
├── utils/          # Cross-cutting helpers
├── workers/        # Worker threads / child processes (agent worker, output parser, whisper, embeddings)
├── scripts/        # Dev, CI-gate and maintenance scripts
└── tests/          # Integration / cross-module tests (most unit tests sit next to their source)
```

Workflow artifacts (research / question / plan / verify) are **not files on
disk**: each is a `WorkflowFile` row (history in `WorkflowFileVersion`),
written through the workflow API.

The **routes → services → prisma** layering is intended to be strict.
Oversized files are tracked by `scripts/check-large-files.cjs` against a
ratchet baseline and should be split per
`.claude/COMPONENT_SPLITTING_POLICY.md`.

### 2.2 Frontend (`rapitas-frontend/`)

```
rapitas-frontend/src/
├── app/            # Next.js App Router pages (about 35 top-level route folders)
├── components/     # Shared UI components
├── feature/        # Feature folders (calendar, search, tasks, …)
├── hooks/          # Custom React hooks
├── stores/         # zustand stores (global state)
├── contexts/       # React context providers
├── lib/            # Pure utilities, API clients
├── styles/         # Tailwind v4 entry + globals
├── types/, utils/, config/, data/
└── i18n/           # Locale config (catalogs in rapitas-frontend/messages/: en.json, ja.json + fragments/)
```

State management split:

- **zustand** — global UI state (theme, filters, modal stacks)
- **SWR** — server data fetching, caching, revalidation
- **React Context** — auth, dark mode, locale

### 2.3 Desktop (`rapitas-desktop/`)

Tauri 2 with the system WebView. The Rust shell:

1. Spawns the Bun-compiled backend binary as a **sidecar** (release builds)
2. Loads the statically exported frontend (`next build` with `output: 'export'`,
   copied into `rapitas-desktop/public/` by `rapitas-desktop/scripts/ci-build.js`)
3. Provides native integrations (notifications, global shortcuts, quick
   capture, terminal, voice, auto-update, extra windows)

There is **no Tauri command wrapping the API** — frontend talks to the backend
via plain HTTP/SSE on `localhost:3001`.

---

## 3. Data model

`rapitas-backend/prisma/schema/` is a `prismaSchemaFolder` layout (see
[ADR-0006](adr/0006-prisma-schema-folder-split.md)) containing about **100
models** across 15 per-domain files plus `_generators.prisma` (as of
2026-11). Prisma merges them at generate time. The desktop SQLite schema
(`rapitas-backend/prisma/schema.desktop/`) is generated from it — never
hand-edit it. The models cluster as follows:

| Sub-domain | Representative models | Notes |
|---|---|---|
| **Core tasks** | `Category`, `Theme`, `Project`, `Milestone`, `Task`, `Comment`, `Label` | Hierarchical: Category → Theme → Project → Task → Subtask |
| **Time tracking** | `TimeEntry`, `PomodoroSession`, `ActivityLog`, `DailyScheduleBlock` | |
| **Notes / resources** | `Note`, `NoteTaskLink`, `Resource` | |
| **AI orchestration** | `AgentSession`, `AgentExecution`, `AgentExecutionLog`, `AIAgentConfig`, `WorkflowQueueItem`, `OrchestraSession`, `ThemeAutoRun` | Multi-provider (Claude/OpenAI/Gemini/Local) |
| **Workflow artifacts** | `WorkflowFile`, `WorkflowFileVersion`, `WorkflowTransition`, `WorkflowRoleConfig`, `WorkflowModeConfig` | research/plan/verify live here, not on disk |
| **Knowledge / memory** | `KnowledgeEntry`, `KnowledgeGraphNode`, `KnowledgeGraphEdge`, `EpisodeMemory`, `MemoryJournalEntry`, `ConsolidationRun` | Long-term agent memory |
| **GitHub integration** | `GitHubIntegration`, `GitHubPullRequest`, `GitHubPRReview`, `GitHubIssue`, `GitCommit` | Bidirectional sync (planned) |
| **Self-improvement** | `Experiment`, `Hypothesis`, `CriticReview`, `LearningPattern`, `WorkflowLearningRecord`, `PromptEvolution` | Research/experimental |
| **PR risk** | `PrRiskConfig`, `PrRiskScore`, `PrOutcome`, … | |
| **Usage budget** | `UsageBudget`, `UsageBudgetThemeShare`, `UsageClassificationRule` | |
| **Tenancy** | `Workspace`, `WorkspaceMember`, `CalendarShare` | |
| **System** | `User`, `UserSession`, `UserSettings`, `Notification`, `ApprovalRequest` | Identity, settings, approvals |

> Layout:
>
> ```
> rapitas-backend/prisma/schema/
> ├── _generators.prisma   # generator + datasource
> ├── core.prisma          # Category, Theme, Project, Milestone, Task, Label, …
> ├── time.prisma          # TimeEntry, PomodoroSession, ActivityLog, DailyScheduleBlock
> ├── behavior.prisma      # UserBehavior, TaskPattern, …
> ├── agents.prisma        # AgentSession, AgentExecution, AIAgentConfig, …
> ├── workflow.prisma      # WorkflowFile, WorkflowQueueItem, OrchestraSession, ThemeAutoRun, …
> ├── memory.prisma        # KnowledgeEntry, KnowledgeGraph*, EpisodeMemory, …
> ├── experiments.prisma   # Experiment, Hypothesis, CriticReview, PromptEvolution, …
> ├── github.prisma        # GitHubIntegration, GitHubPullRequest, GitCommit, …
> ├── system.prisma        # User, UserSession, UserSettings, Notification, …
> ├── schedule.prisma      # ScheduleEvent, PaidLeaveBalance, CalendarBusyBlock, … (+ 1 enum)
> ├── notes.prisma         # Note, NoteTaskLink
> ├── resources.prisma     # Resource
> ├── pr-risk.prisma       # PrRiskConfig, PrRiskScore, PrOutcome, …
> ├── usage-budget.prisma  # UsageBudget, …
> └── tenancy.prisma       # Workspace, WorkspaceMember, CalendarShare
> ```

---

## 4. Runtime considerations

### Three runtimes coexist

- **Bun** for `rapitas-backend` (hot-reload + standalone compile for sidecar)
- **pnpm** for `rapitas-frontend` and `rapitas-desktop` (Next.js + Tauri ecosystem)
- **npm** for the root workspace (see ADR 0001)

This is a known source of friction. The mitigation is in
`scripts/preflight-check.cjs`, which validates all three are installed before
`npm run dev`.

### AI agent self-modification loop

The backend exposes a **workflow API** (`/workflow/tasks/{taskId}/files/...`)
that AI agents — including Claude Code itself — call to save
`research.md`, `plan.md`, and `verify.md`. Despite the names these are not
files: each is a `WorkflowFile` row in the database (prior content moves to
`WorkflowFileVersion`).
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

SSE is the only realtime transport. An unmounted native-`ws` service and its
only consumer (an alternate backend entry point no script ran) were deleted
as dead code. There is **no** Socket.IO anywhere in the repo — see
[ADR-0005](adr/0005-realtime-transport.md) for that history.

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
bundles `.exe`/`.msi`/`.dmg`/`.deb`/`.rpm` artifacts. The frontend is
statically exported and copied into `rapitas-desktop/public/` (the release
`frontendDist`). Releases are triggered
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
| Backend tests | `test-lint.yml` (`Test Backend`) | Runs the `backend-tests` gate (`rapitas-backend/scripts/ci-gates.ts`, file list `rapitas-backend/scripts/ci-gate-tests.txt`) with `--coverage`; the `coverageFloor` (lines / functions) in `ci-gates.ts` is enforced |
| Route regression | `test-lint.yml` (`Route Regression`) | `route-regression` gate, no coverage |
| SQLite suite | `test-lint.yml` (`Test SQLite Compatible Suite`) | `sqlite-tests` gate |
| Full backend suite | `test-lint.yml` (`Full Suite (Advisory)`) | Advisory (`continue-on-error`) |
| Frontend tests | `test-lint.yml` (`Check Frontend`) | `vitest run --coverage` over a named list of test files (not the full suite); the thresholds in `rapitas-frontend/vitest.config.ts` are enforced for that list |
| Frozen install | `test-lint.yml` (`Frozen Install Verification`) | Lockfiles must install unchanged |
| Type check | `test-lint.yml` | `tsc --noEmit` for both apps |
| Lint / format | `test-lint.yml` | ESLint + Prettier |
| Rust clippy | `test-lint.yml` (`Check Rust Code`, `Check Rust Code (Windows)`) | `cargo clippy -- -D warnings` |
| Trivy | `security-scan.yml` | CRITICAL/HIGH on filesystem |
| CodeQL | `security-scan.yml` | JS/TS |
| `cargo audit` | `security-scan.yml` | Tauri dependencies |
| `npm audit` | `security-scan.yml` | `pnpm audit` (frontend, desktop) + `bun audit` (backend) |
| Gitleaks | `gitleaks.yml` | Secret scanning |
| actionlint | `actionlint.yml` | Workflow YAML lint |
| Knip | `knip.yml` | Advisory (unused exports/deps) |
| Bundle size | `bundle-size.yml` | Advisory (per-chunk + total budget) |
| Version sync | `version-check.yml` | Hard fail if manifests drift |
| File size | `file-size.yml` | Per-file line limits with a ratchet baseline |
| HACK/FIXME ceilings | `todos-check.yml` | ADR-0004 |
| Markdown lint | `markdownlint.yml` | Advisory |
| Tauri build | `tauri-build.yml` | 4 platforms; tag-driven release |

See also: `.github/CI_CD_SETUP.md`.

---

## 7. Open architectural questions

1. **Schema-first vs code-first** for Prisma — currently `db push` based, no
   migration history (the migrations directory has been removed). ADR-0003 calls
   for moving to `prisma migrate` before public release.
2. **Module ownership** — about 100 models split across 15 per-domain files (ADR-0006)
   still lacks CODEOWNERS-by-domain, so cross-domain ownership is unclear.
3. **AI agent isolation** — agents currently share the same DB. Multi-tenant
   isolation (per-user agents) is unclear.
4. **Three runtimes** — see ADR 0001.

---

## See also

- `.claude/CLAUDE.md` — agent operating constraints (section 1 is non-negotiable)
- `AGENTS.md` — the same constraints for non-Claude agents
- `docs/adr/` — architecture decision records
- `.claude/COMPONENT_SPLITTING_POLICY.md` — file size limits
- `.claude/FOLDER_ORGANIZATION_POLICY.md` — directory layout rules
- [docs/README.md](README.md) — index of the other docs
