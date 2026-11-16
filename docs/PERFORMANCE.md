# Performance notes

Known bottlenecks, optimization techniques in use, and the budgets we
intend to enforce. This is a **living document** — add a section any time
you measure something interesting or apply a fix that survives review.

> Whenever you change a number in this document, include the **measurement
> command** so future contributors can reproduce it.

---

## 1. Targets

| Surface                         | Metric                | Target   | Current (2026-04-28) | Measurement Command                |
| ------------------------------- | --------------------- | -------- | -------------------- | ---------------------------------- |
| Backend cold start (Bun)        | time to first request | < 500 ms | ~200 ms              | `time curl localhost:3001/agents/health` |
| Backend p95 task list endpoint  | latency               | < 150 ms | ~80 ms               | `npm run perf`                     |
| Backend p95 settings endpoint   | latency               | < 100 ms | ~30 ms               | `npm run perf`                     |
| Frontend static JS bundle       | total size            | < 500 KB | ~350 KB              | `npm run perf`                     |
| Frontend `/home` LCP (dev)      | local Lighthouse      | < 2.5 s  | ~1.8 s               | `lighthouse http://localhost:3000` |
| Tauri cold launch               | window paint          | < 1.5 s  | not measured         | manual stopwatch                   |
| Tauri installer size            | per platform          | < 30 MB  | ~25 MB               | file size check                    |
| SSE p95 broadcast latency       | round-trip            | < 100 ms | not measured         | custom test                        |

**Measurement commands:**

```bash
# Run full performance measurement
npm run perf

# API-only measurement (requires backend running)
curl -w "@curl-format.txt" -o /dev/null -s http://localhost:3001/tasks

# Frontend bundle analysis
cd rapitas-frontend && pnpm build && ls -la .next/static/chunks/
```

---

## 2. Known bottlenecks

### 2.1 ~~Prisma `schema.prisma` monolith~~ (resolved 2026-04-09)

Resolved per [ADR-0006](adr/0006-prisma-schema-folder-split.md): the
former single-file Prisma schema (1426 lines, 72 models, 1 enum) was split into
per-domain files under `rapitas-backend/prisma/schema/` using Prisma's
`prismaSchemaFolder` layout (GA in Prisma 6; 16 domain files as of 2026-11).
Editor latency and `prisma generate` runtime should improve correspondingly —
measure and update §1 once observed.

### 2.2 Frontend `useExecutionManager.ts` (about 490 lines as of 2026-11)

`rapitas-frontend/src/feature/developer-mode/components/ai-accordion-panel/useExecutionManager.ts`

**Symptom:** This hook is on the agent execution panel critical path. Re-renders
inside it propagate to the entire developer mode UI.

**Why:** It conflates state, IO, polling, and render derivation — and the
file is near the hard 500-line limit.

**Mitigation (planned):** Split per
[`COMPONENT_SPLITTING_POLICY.md`](../.claude/COMPONENT_SPLITTING_POLICY.md) into
`useExecutionState`, `useExecutionPolling`, `useExecutionDispatch`, and a
thin orchestrator hook.

### 2.3 ~~Backend `agent-core.ts` (1012 lines)~~ (resolved)

`rapitas-backend/services/agents/claude-code/agent-core.ts` has since been
split and is about 450 lines (2026-11).

### 2.4 Bun + Playwright pipe hang on Windows

**Symptom:** `--remote-debugging-pipe` hangs forever when launched directly
from Bun.

**Why:** [oven-sh/bun#23826](https://github.com/oven-sh/bun/issues/23826)

**Mitigation:** Already in place. Browser automation runs in a Node.js
subprocess
(`rapitas-backend/services/agents/verification/runtime-smoke/playwright-worker.mjs`,
driven by `playwright-worker-client.ts`). See
[RUNBOOK §5](RUNBOOK.md#5-bun--playwright-pipe-hang-windows).

### 2.5 Wide schema (about 100 models) → wide JOINs

**Symptom (anticipated):** Once the dataset grows, common task-list endpoints
that include `category`, `theme`, `project`, `milestone`, `labels`, `comments`
will produce wide JOINs and large response payloads.

**Mitigation strategy:**

- Use Prisma `select` instead of `include` on list endpoints — only ship
  fields the UI actually renders
- Add `@@index` directives in `rapitas-backend/prisma/schema/*.prisma` for the foreign-key columns
  that appear in `where` filters
- Paginate aggressively (cursor-based, default page size 50)
- For derived fields (e.g. `taskCount` per category), maintain a
  denormalized counter or use a materialized view

### 2.6 ~~Two realtime transports~~ (resolved 2026-04-09)

Resolved per [ADR-0005](adr/0005-realtime-transport.md): the supposed
"second transport" (Socket.IO Client) was dead code in a frontend API client
with no consumers. The file and the dependency have been removed. The single
realtime transport is SSE (see [ARCHITECTURE §4](ARCHITECTURE.md#realtime));
the unmounted backend `ws` service was later deleted as well.

---

## 3. Optimization techniques in use

### 3.1 Frontend

- **SWR** for caching and dedup
- **`task-cache-store`** (`rapitas-frontend/src/stores/task-cache-store.ts`):
  an in-memory task list capped at 800 entries (oldest completed tasks are
  evicted first), refreshed incrementally with the `X-Server-Cursor` header.
  It is not persisted to localStorage
- **Skeleton loaders** to prevent layout shift
  (`rapitas-frontend/src/app/home/_components/HomeTaskList.tsx`, `HomeFilterPanel.tsx`)
- **Specific `transition-*` properties** instead of `transition-all` to
  avoid resize re-triggers
- **Recharts** with memoized data shapers
- **`use client`** — most pages are client components today (44 of 57
  `page.tsx` files start with `'use client'`), so this is not a current strength

### 3.2 Backend

- **`lru-cache`** for hot path lookups (configured per service)
- **Bun standalone compile** for production — eliminates JS startup overhead
- **Pino** with async transport to keep logging off the request path
- **Indexed Prisma queries** (where `@@index` is declared)

### 3.3 Tauri

- **Separate backend process** — the Bun-compiled backend runs as a child
  process that the Rust shell supervises (ADR-0010), not in the WebView process
- **Static export** (`output: 'export'`) eliminates Next.js server runtime

---

## 4. Profiling commands

### Backend memory snapshot

```bash
cd rapitas-backend
bun --inspect-brk index.ts
# Open chrome://inspect, take a heap snapshot
```

### Backend route timing

```bash
# Add temporarily to a route handler:
const start = performance.now();
// ... handler body ...
console.log(`${request.method} ${url.pathname} ${(performance.now() - start).toFixed(1)}ms`);
```

### Frontend bundle analysis

```bash
cd rapitas-frontend
ANALYZE=1 pnpm build  # if @next/bundle-analyzer is wired up
# or:
pnpm build && node ../scripts/check-bundle-size.cjs .next
```

### Prisma query log

```bash
# rapitas-backend/.env
DEBUG="prisma:query"
```

This logs every SQL query Prisma issues — use sparingly, very chatty.

### Frontend React profiler

1. Open Chrome DevTools → Profiler tab
2. Record interaction
3. Look for components with > 16 ms render time

---

## 5. Anti-patterns to avoid

1. **`include` cascades in Prisma** — one nested include adds a JOIN; three
   become a Cartesian product.
2. **`useEffect` with object deps** — referential equality fails; use
   `useMemo` or extract primitives.
3. **`new Date()` in render** — produces a fresh value every render; cache
   above the render scope.
4. **Synchronous file I/O on the request path** — use `node:fs/promises`.
5. **Unbounded array operations on hot paths** — `.find()` on a 10k array
   per request adds up; use a `Map`.
6. **Logging full objects at info level** — pino serializes them; use
   `log.debug({ id })` or pino's `serializers`.

---

## 6. How to add a new entry

1. Measure first (with a command).
2. Apply the fix.
3. Measure again with the same command.
4. Add a section here with: symptom, command, before, after, link to PR.
5. Update the targets table in §1 if you set a new budget.
