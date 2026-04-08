# Architecture

Rapitas is a hierarchical, AI-augmented task manager delivered as both a web app
and a Tauri desktop app. This document is a high-level map of the system —
**what runs where, and which boundaries matter**. For module-level details,
read the source under each subproject.

> Last reviewed: 2026-04-08

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
│  zustand + SWR         │   │  WebSocket + Redis     │
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
├── prisma/         # schema.prisma (71 models — see §3)
├── utils/          # Cross-cutting helpers
├── workers/        # Background jobs (transcription, screenshot, etc.)
└── tasks/          # Workflow files written by AI agents (research/plan/verify)
```

The **routes → services → prisma** layering is intended to be strict, but
several oversized files violate it (`routes/tasks/tasks.ts` 881 lines,
`services/agents/claude-code/agent-core.ts` 1012 lines). These are flagged
in `project-improve.md` and should be split per `COMPONENT_SPLITTING_POLICY.md`.

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
└── i18n/           # Locale catalogs (partial coverage)
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
via plain HTTP/WebSocket on `localhost:3001`.

---

## 3. Data model

`rapitas-backend/prisma/schema.prisma` defines **71 models** in a single 1426-line
file. They cluster into the following sub-domains:

| Sub-domain | Representative models | Notes |
|---|---|---|
| **Core tasks** | `Category`, `Theme`, `Project`, `Milestone`, `Task`, `Comment`, `Label` | Hierarchical: Category → Theme → Project → Task → Subtask |
| **Time tracking** | `TimeEntry`, `PomodoroSession`, `ActivityLog`, `DailyScheduleBlock` | |
| **Learning** | `ExamGoal`, `LearningGoal`, `Habit`, `HabitLog`, `Resource`, `FlashcardDeck`, `Flashcard` | Spaced repetition via `ts-fsrs` |
| **AI orchestration** | `AgentSession`, `AgentExecution`, `AgentExecutionLog`, `AIAgentConfig`, `WorkflowQueueItem`, `OrchestraSession` | Multi-provider (Claude/OpenAI/Gemini/Local) |
| **Knowledge / memory** | `KnowledgeEntry`, `KnowledgeGraphNode`, `KnowledgeGraphEdge`, `EpisodeMemory`, `MemoryJournalEntry`, `ConsolidationRun` | Long-term agent memory |
| **GitHub integration** | `GitHubIntegration`, `GitHubPullRequest`, `GitHubPRReview`, `GitHubIssue`, `GitCommit` | Bidirectional sync (planned) |
| **Self-improvement** | `Experiment`, `Hypothesis`, `CriticReview`, `LearningPattern`, `WorkflowLearningRecord`, `PromptEvolution` | Research/experimental |
| **System** | `User`, `UserSession`, `UserSettings`, `Notification`, `ApprovalRequest` | Identity, settings, approvals |

> **Recommended refactor:** Split `schema.prisma` per sub-domain using
> Prisma 5+'s `prismaSchemaFolder` preview feature. See `project-improve.md`.

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
Two realtime channels coexist:
- **Native `ws`** for backend internals (agent execution events)
- **Socket.IO Client** on the frontend for app-level updates

These should be unified in a future refactor.

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
| Frontend tests | `test-lint.yml` | Active, line coverage ≥ 15% (will be raised) |
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
2. **Module ownership** — 71 models in a single file makes ownership unclear.
   Sub-folder Prisma + CODEOWNERS-by-domain would help.
3. **AI agent isolation** — agents currently share the same DB. Multi-tenant
   isolation (per-user agents) is unclear.
4. **Realtime unification** — two transports (`ws` + Socket.IO) is technical debt.
5. **Three runtimes** — see ADR 0001.

---

## See also
- `CLAUDE.md` — agent operating constraints (section 1 is non-negotiable)
- `docs/adr/` — architecture decision records
- `COMPONENT_SPLITTING_POLICY.md` — file/dir size limits
- `FOLDER_ORGANIZATION_POLICY.md` — directory layout rules
- `project-improve.md` — running improvement backlog
