# 0005. Realtime transport: keep `ws`, remove dead Socket.IO

- Status: accepted — **implemented 2026-04-09**
- Date: 2026-04-08
- Deciders: @takamurayuki

## Context

`docs/ARCHITECTURE.md` (and earlier reviews) listed "two coexisting realtime
transports" as a maintenance burden:

- **Backend (`ws`)** — `rapitas-backend/services/communication/websocket-service.ts`
  (449 lines), wired through Elysia's WebSocket plugin
- **Frontend (`socket.io-client`)** — declared in
  `rapitas-frontend/package.json` as `socket.io-client@^4.8.3`

A direct grep of the source on 2026-04-08 produced a surprising result:

| Search target | Hits |
|---|---|
| `socket.io` / `socketio` under `rapitas-frontend/src/` | **0** |
| `from 'socket.io-client'` under `rapitas-frontend/src/` | **0** |
| `from 'socket.io-client'` anywhere in the repo | **1** — only `rapitas-frontend/lib/api-client-optimized.ts` |
| References to `api-client-optimized` from anywhere | **1** — only the file itself |

In other words, `socket.io-client` is **dead code**:

- The only consumer is `lib/api-client-optimized.ts`, which is **outside
  `src/`** and not imported by any page, hook, component, or route
- The matching backend Socket.IO server does **not exist** — the backend only
  speaks raw WebSocket via `ws`
- The library still pulls bytes into the frontend bundle and shows up in
  every dependency audit and license review

There is no "realtime duality" to unify. There is **one realtime transport
(`ws`) plus a phantom dependency**.

## Decision

We **standardize on the native `ws` transport**, both backend and frontend.
Specifically:

1. **Remove `socket.io-client`** from `rapitas-frontend/package.json` and the
   lockfiles (`pnpm-lock.yaml`, `bun.lock`).
2. **Delete `rapitas-frontend/lib/api-client-optimized.ts`**. It is dead
   code; if any of its features are wanted (batching, optimistic cache
   invalidation, etc.) they will be re-implemented inside `src/lib/` against
   the existing `ws`-based backend, with tests.
3. **Document** in `docs/ARCHITECTURE.md` §4 that the frontend talks to the
   backend via plain HTTP/WebSocket on `localhost:3001`, with no Socket.IO
   compatibility layer.
4. **Forbid** new uses of `socket.io-client` via a Knip / lint rule once the
   removal lands.

If, at some future point, we need a feature that genuinely requires
Socket.IO (rooms, namespaces, automatic reconnection-with-state), we will
**revisit this decision in a follow-up ADR** rather than silently
re-introducing the dependency.

## Alternatives considered

### A. Migrate the backend to Socket.IO
- Pros: Richer client API. Battle-tested room/namespace primitives.
- Cons: Adds a server dependency where none exists today. Breaks the
  Bun-compiled standalone backend (Socket.IO has historically had issues
  with non-Node runtimes). The 449-line `websocket-service.ts` already
  works.
- Verdict: Rejected — solves a problem we don't have.

### B. Keep `socket.io-client` "in case we need it"
- Pros: Zero immediate work.
- Cons: Dead dependency = silent license/CVE liability + bundle bloat.
  Future contributors will assume Socket.IO is integrated and waste time
  trying to use it.
- Verdict: Rejected — keeping unused deps is a smell.

### C. Reactivate `api-client-optimized.ts` and wire it to `src/`
- Pros: The file already implements batching, cache invalidation, and a
  WebSocket subscription model.
- Cons: 500+ lines of code with no tests, no consumers, and bit-rot
  potential. Re-introducing it is a feature decision that should go through
  the normal workflow (research → plan → implement), not be smuggled in via
  this ADR.
- Verdict: Rejected for the scope of this ADR. May be revisited later as a
  separate proposal.

## Consequences

### Positive
- One transport, one mental model. No more "are we using `ws` or
  Socket.IO?" confusion.
- Smaller dependency surface (no `socket.io-client`, no `engine.io-client`,
  no `socket.io-parser`).
- Smaller frontend bundle.
- Cleaner license review and dep-review workflow.

### Negative
- Loses the Socket.IO client features (auto-reconnect with state, rooms,
  namespaces) that **we never used in the first place**, so this is mostly
  hypothetical.
- Anyone who copy-pasted code from `api-client-optimized.ts` (unlikely —
  it has no consumers) will need to rewrite against the real `ws` API.

### Neutral
- The 449-line `websocket-service.ts` is itself over the soft size limit
  (300) but under the hard limit (500). Splitting it is tracked separately
  per `COMPONENT_SPLITTING_POLICY.md`, not by this ADR.

## Follow-ups

- [x] Remove `socket.io-client` from `rapitas-frontend/package.json` (2026-04-09)
- [x] Delete `rapitas-frontend/lib/api-client-optimized.ts` (2026-04-09)
- [x] Delete the now-empty `rapitas-frontend/lib/` directory (2026-04-09)
- [x] Update `docs/ARCHITECTURE.md` §4 — drop the "two transports" line (2026-04-09)
- [x] Update `README.md` — remove Socket.IO Client mention (2026-04-09)
- [x] Update `docs/PERFORMANCE.md` §2.6 — mark as resolved (2026-04-09)
- [ ] Lockfile cleanup: `pnpm-lock.yaml` and `bun.lock` still contain
      orphaned `socket.io-client@4.8.3`, `socket.io-parser`, and
      `@socket.io/component-emitter` entries. The next `pnpm install`
      (CI uses `--no-frozen-lockfile`) will purge them automatically;
      no hand-edit needed.
- [ ] (Optional) Add a Knip rule that flags any new `socket.io*` import
- [ ] If a future feature legitimately needs Socket.IO, supersede this ADR
