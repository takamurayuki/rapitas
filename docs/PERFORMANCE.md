# Performance notes

Known bottlenecks, optimization techniques in use, and the budgets we
intend to enforce. This is a **living document** — add a section any time
you measure something interesting or apply a fix that survives review.

> Whenever you change a number in this document, include the **measurement
> command** so future contributors can reproduce it.

---

## 1. Targets

| Surface | Metric | Target | Current (2026-04-08) |
|---|---|---|---|
| Backend cold start (Bun) | time to first request | < 500 ms | not measured |
| Backend p95 task list endpoint | latency | < 150 ms | not measured |
| Frontend `/home` first load JS | gzipped | < 250 KB | not measured |
| Frontend `/home` LCP (dev) | local Lighthouse | < 2.5 s | not measured |
| Tauri cold launch | window paint | < 1.5 s | not measured |
| Tauri installer size | per platform | < 30 MB | not measured |
| WebSocket p95 broadcast latency | round-trip | < 100 ms | not measured |

These targets are aspirational until they have measurements next to them.
The first PR that adds a measurement should also add the command used to
take it.

---

## 2. Known bottlenecks

### 2.1 ~~Prisma `schema.prisma` monolith~~ (resolved 2026-04-09)

Resolved per [ADR-0006](adr/0006-prisma-schema-folder-split.md): the
1426-line `schema.prisma` (72 models, 1 enum) was split into 11 per-domain
files under `rapitas-backend/prisma/schema/` using Prisma's
`prismaSchemaFolder` preview feature. Largest resulting file is
`core.prisma` at 226 lines. Editor latency and `prisma generate` runtime
should improve correspondingly — measure and update §1 once observed.

### 2.2 Frontend `useExecutionManager.ts` (609 lines)

**Symptom:** This hook is on the agent execution panel critical path. Re-renders
inside it propagate to the entire developer mode UI.

**Why:** It conflates state, IO, polling, and render derivation — and the
file is over the hard 500-line limit.

**Mitigation (planned):** Split per
[`COMPONENT_SPLITTING_POLICY.md`](../COMPONENT_SPLITTING_POLICY.md) into
`useExecutionState`, `useExecutionPolling`, `useExecutionDispatch`, and a
thin orchestrator hook.

### 2.3 Backend `agent-core.ts` (1012 lines)

**Symptom:** Slow editor open + slow type-check on this file.

**Why:** All Claude Code orchestration logic in one module.

**Mitigation (planned):** Split into provider/state/io per ADR-style module
boundaries (see `project-improve.md`).

### 2.4 Bun + Playwright pipe hang on Windows

**Symptom:** `--remote-debugging-pipe` hangs forever when launched directly
from Bun.

**Why:** [oven-sh/bun#23826](https://github.com/oven-sh/bun/issues/23826)

**Mitigation:** Already in place. Screenshot worker runs as a Node.js
subprocess (`screenshot-worker.cjs`). See
[RUNBOOK §5](RUNBOOK.md#5-bun--playwright-pipe-hang-windows).

### 2.5 71-model schema → wide JOINs

**Symptom (anticipated):** Once the dataset grows, common task-list endpoints
that include `category`, `theme`, `project`, `milestone`, `labels`, `comments`
will produce wide JOINs and large response payloads.

**Mitigation strategy:**
- Use Prisma `select` instead of `include` on list endpoints — only ship
  fields the UI actually renders
- Add `@@index` directives to `schema.prisma` for the foreign-key columns
  that appear in `where` filters
- Paginate aggressively (cursor-based, default page size 50)
- For derived fields (e.g. `taskCount` per category), maintain a
  denormalized counter or use a materialized view

### 2.6 ~~Two realtime transports~~ (resolved 2026-04-09)

Resolved per [ADR-0005](adr/0005-realtime-transport.md): the supposed
"second transport" (Socket.IO Client) was dead code in
`rapitas-frontend/lib/api-client-optimized.ts` with no consumers. The file
and the dependency have been removed; the backend's native `ws` is the
single realtime transport.

---

## 3. Optimization techniques in use

### 3.1 Frontend
- **SWR** for caching and dedup — see `src/lib/swr-config.ts` (if present)
- **`task-cache-store`** with localStorage persistence + 24h cache window
  (see `MEMORY.md` 2026-02-19 v3 entry)
- **Skeleton loaders** to prevent layout shift (`HomeClient.tsx`)
- **Specific `transition-*` properties** instead of `transition-all` to
  avoid resize re-triggers (`MEMORY.md` 2026-02-19 v1)
- **Recharts** with memoized data shapers
- **`use client` only where needed** — most pages remain server components

### 3.2 Backend
- **`lru-cache`** for hot path lookups (configured per service)
- **Bun standalone compile** for production — eliminates JS startup overhead
- **Pino** with async transport to keep logging off the request path
- **Indexed Prisma queries** (where `@@index` is declared)

### 3.3 Tauri
- **Sidecar pattern** for the backend binary — single-process model
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
