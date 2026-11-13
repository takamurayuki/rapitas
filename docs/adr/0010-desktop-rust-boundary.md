# 0010. What moves from the backend sidecar into the desktop's Rust

- Status: accepted
- Date: 2026-11-14
- Deciders: @takamurayuki

## Context

The desktop app (Tauri, `rapitas-desktop/src-tauri/`) wraps the backend
almost as-is: release builds start the Bun-compiled backend as a sidecar
(`rapitas-desktop/src-tauri/src/release.rs`), and in development
`rapitas-desktop/scripts/dev.js` starts it. Rust today owns only what is
native to the desktop shell: windows, the tray, global shortcuts, the toast
window, the integrated terminal (PTY) and voice capture.

Moving more into Rust is on the table, a little at a time, when there is a
reason. Without a written boundary, each move would be argued from scratch,
and "Rust is faster" would be enough to start one. This ADR fixes the
boundary so later moves follow it instead of re-deciding it.

Two facts shape the boundary:

1. **The backend is shared.** The same backend serves the web stack
   (PostgreSQL) and the mobile app, and all of the product's logic — tasks,
   goals and milestones, the agent workflow, verification gates, AI calls,
   the database — lives in it with its tests. A second implementation in
   Rust would be a second copy that can drift, on one platform only.
2. **The desktop's recurring outages are about process lifetime, not
   speed.** Incidents recorded while running the desktop stack include: a
   process holding port 3001 after the app was gone (2026-08-12; a two-hour
   outage on 2026-10-10), a leftover `rapitas.exe` holding the global hotkey
   so every new instance exited at startup (2026-09-02), agent CLI and
   helper processes surviving their parent (`rapitas-backend/services/agents/process-tree-kill.ts`
   exists to chase them), a backend that exited with code 0 and was never
   restarted (2026-11-07), and a backend answering `/health` while still
   warming up. Each of these is a parent process not owning its children —
   something only the outermost process, the Rust shell, can fix.
   The CPU stalls seen in the backend come from AI and JSON work, which a
   language change would not remove.

## Decision

### A responsibility moves into Rust only if it passes all three tests

1. **Desktop-only** — it means nothing on the web stack or for the mobile app.
2. **About the OS or about process lifetime** — window/OS integration, OS
   events, or owning and supervising processes. Not product logic.
3. **The separate process is the problem, or the OS API is not reachable
   from Bun** — e.g. children outliving the backend, or an OS notification
   with no workable Node/Bun binding.

Performance alone is never the reason. A move made for speed needs a
measurement showing the language is the bottleneck, and a superseding ADR.

### Owned by Rust (the desktop shell)

| Responsibility | Status |
|---|---|
| Windows, tray, global shortcuts, toast and float windows | in Rust |
| Integrated terminal (PTY), voice capture | in Rust |
| Starting and stopping the backend sidecar | in Rust (`release.rs`), dev via `dev.js` |
| **Process supervision**: the backend and all its descendants live in a Windows Job Object (kill-on-close; process groups elsewhere), so quitting or crashing the app ends every agent CLI, git and tsc process it started | **phase 1** |
| **Readiness and restart**: wait for the backend to report ready (not just `/health`), restart it on any unexpected exit including code 0, with back-off | **phase 1** |
| OS events the product reacts to: sleep/resume, lock/unlock, idle, network change — forwarded to the backend over its HTTP API | phase 2, only when a feature needs one |

### Stays in the backend (TypeScript)

- All product logic: tasks, goals and milestones, the agent workflow and
  orchestration, verification gates, AI calls, notifications' content.
- The database and its schema (Prisma; `rapitas-backend/config/desktop-sqlite.ts`
  keeps applying the desktop's SQLite init SQL).
- Spawning agent CLIs and git. Rust contains them (Job Object); the backend
  still decides when to start and stop them.
- Secrets: already in the OS keychain through
  `rapitas-backend/utils/common/encryption-key-resolver.ts`; no reason to move.

### How a move is made

1. **One owner per responsibility.** The change that moves something into
   Rust removes it from the backend in the same change (or leaves the backend
   path only for the web stack, behind a desktop check). Never both running.
2. **Rust talks to the backend over the backend's HTTP API on 127.0.0.1**, or
   passes values at spawn time (environment variables). No shared files as a
   channel, no Rust code reading the database.
3. **Measure before and after.** Record the baseline the move is meant to
   change (e.g. orphaned processes or port-3001 holders after quitting,
   unrestarted backend exits) before writing it, and check it afterwards.
4. **Tests on both sides of the seam**: Rust unit tests for the shell's
   decisions; backend tests stay as they are, since its contract does not change.

## Alternatives considered

1. **Keep wrapping the backend unchanged** — no new Rust code, but the
   process-lifetime incidents above cannot be fixed from inside the child
   process; the backend can chase its own children (`process-tree-kill.ts`)
   but cannot clean up after itself when it is the one that died.
2. **Port the backend to Rust gradually by feature** — would give one native
   binary, but splits product logic across two languages on one platform
   only, duplicates what web and mobile still need from the TypeScript
   backend, and throws away the TypeScript test suite and gates for each
   ported piece. Nothing measured shows the language is a bottleneck.
3. **Supervise from a separate Node watchdog process** — avoids Rust, but
   adds a third long-lived process with the same "who watches the watcher"
   problem; the Tauri shell is already the outermost process and already
   spawns the sidecar.

## Consequences

- Positive: the class of outages caused by orphaned or unsupervised
  processes gets one owner that outlives all of them; future moves are
  judged against three written tests instead of argued anew.
- Negative: the dev stack (`dev.js`) and release (`release.rs`) start the
  backend differently, so supervision has to be built for both or dev keeps
  its own; Windows Job Objects and Unix process groups need separate code.
- Neutral: the backend's API and behaviour do not change; the web stack and
  mobile app are unaffected.

## Follow-ups

- [x] Phase 1 (Windows, release builds): the sidecar runs in a kill-on-close
      Job Object (`rapitas-desktop/src-tauri/src/sidecar_job.rs`); every exit
      goes through a restart policy with back-off and a give-up toast, and a
      backend that never reports `ready: true` is killed and restarted
      (`rapitas-desktop/src-tauri/src/sidecar_policy.rs`, `release.rs`). The
      baseline is pinned as a test: killing only the parent leaves its child
      running; closing the job ends both, including children started later.
- [x] `dev.js` keeps its own supervision. In development the backend must
      outlive the app window — agents and the developer use it while the
      window is closed or rebuilt — so tying it to the window's job would
      break that. Revisit only if dev shows the same orphan problem.
- [ ] Phase 1 on macOS / Linux: contain the sidecar's descendants (process
      group or `PR_SET_PDEATHSIG`); needs a spawn path with `pre_exec`, which
      tauri-plugin-shell's `Command` does not offer.
- [ ] Measure in a release install: processes left after quitting, and
      restarts / give-ups from the `[Backend]` log lines.
- [ ] Phase 2 only when a feature needs an OS event: sleep/resume, lock, idle,
      network change.
