# Development-loop hazards

Environment traps that cost real time on 2026-10-17. Each is stated as the
symptom first, because that is how it will be met again.

---

## Merged code is not running code

**Symptom.** A change is merged to `develop`, `main` is synced, every test is
green — and the behaviour does not change. A newly added notification type
never appears; a new gate never fires.

**Cause.** The dev backend runs from the **primary checkout**
(`C:\Projects\rapitas`). Nothing pulls it, and hot reload is off by default
(`node scripts/dev.js --watch` enables it; the default uses `dev:stable` so
graceful shutdown handlers run). Eight merges landed in one session while the
process stayed on the commit it booted with.

**Confirm it in one command** — from any worktree, without touching the
primary path:

```bash
git worktree list | head -1      # primary's checked-out commit
git rev-parse --short origin/develop
```

**Fix.** Since #1024 the backend fast-forwards the primary checkout itself at
the auto-run quiet point and restarts. That needs two things to be true:

- `restartOnAutoRunDry` is on (`PATCH /settings`, `{"restartOnAutoRunDry": true}`)
- at least one theme has auto-run enabled — the armed-theme gate is
  deliberate, because "I stopped auto-run and it restarted anyway" was a
  reported surprise

With auto-run off everywhere, the manual path remains:

```powershell
git -C C:\Projects\rapitas pull --ff-only origin develop
curl.exe -s -X POST http://127.0.0.1:3001/agents/restart
```

`POST /agents/restart` is a graceful restart — it drains execution owners,
saves state and exits 75 so `dev.js` relaunches. It is **not** a kill, and
in-flight executions come back as resumable. It is not covered by CLAUDE.md §1,
which forbids killing the process.

## Japanese text does not survive the shell

**Symptom.** A `python -c` or heredoc replacement reports success, and the
file is either unchanged or filled with mojibake. Or a string match that is
visibly identical fails with no explanation.

**Cause.** Japanese passed through the Bash tool's command text is re-encoded
on the way in. The script then searches for bytes that are not in the file.

**Fix.** Use the `Edit` / `Write` tools for any file content containing
Japanese. Reserve shell scripting for ASCII-only transformations. The same
applies to PowerShell bulk replacement, which destroys UTF-8 Japanese
outright.

## PowerShell is not bash

The `!` prefix runs commands in **Windows PowerShell 5.1**:

| Habit       | What happens                                                  | Use instead                                  |
| ----------- | ------------------------------------------------------------- | -------------------------------------------- |
| `a && b`    | Parser error — `&&` is not a statement separator              | `a; b`, or `a; if ($?) { b }`                |
| `curl ...`  | `curl` is an alias for `Invoke-WebRequest`; flags are misread | `curl.exe ...`                               |
| `cd x && y` | Both problems at once                                         | `git -C <path> ...` avoids the `cd` entirely |

## Directory names are not route segments

**Symptom.** `POST /agents/system/restart` returns
`{"error":"Resource not found"}`.

**Cause.** The router lives in `routes/agents/system/agent-system-router.ts`
but declares `new Elysia({ prefix: '/agents' })`. The `system/` directory is
organisation, not path.

**Fix.** Read the `prefix` on the router rather than inferring from the file
path, and confirm with a harmless `GET` on the same router before firing a
`POST` that does something:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/agents/health
```

A 404 from a guessed URL means nothing happened — which is worth knowing
before concluding that an action failed.

## The task list API is paginated

`GET /tasks?limit=1000` returns at most 500 rows. A count taken from that
response is a count of the page, not of the table. Fetch a specific task by
id when confirming that one exists.

## Running backend services out of process

Dry-running a service module in a second process is a good way to measure
before committing — but importing anything that reaches `config/database`
starts a second Prisma client against the live SQLite file and blocks
indefinitely. That block has previously been misdiagnosed as a product hang.

Keep dry-run scripts to pure modules. `services/organization/spec-*.ts`,
`screen-task-*.ts` and `runtime-smoke/feature-reachability.ts` are all safe to
import this way; anything that touches `prisma` is not.

## `pause` stops the next phase, not just the next task

**Symptom.** A theme's auto-run is paused while a task is mid-workflow. The
task stays `in-progress` with no agent, no execution record and
`activeExecutions: 0` — stranded rather than finished.

**Cause.** Pausing stops the loop that dispatches phases, not only the one
that selects tasks. A task that had completed research sat at
`in-progress/in_progress` with its implementer never dispatched.

Do not confuse this with the separate, documented behaviour that a _running_
`WorkflowQueueItem` keeps holding the single concurrency slot. Both are true
and they are about different things.

**Recovery.** A restart resets the stranded task to `todo` while keeping its
`workflowStatus`, so it resumes at the phase it reached rather than from the
beginning. Confirm with:

```bash
curl -s http://127.0.0.1:3001/agents/system-status   # activeExecutions, runningExecutions
curl -s http://127.0.0.1:3001/tasks/<id>/executions  # 0 rows means nothing ran
```

**And:** this makes a pause a reasonable way to stop before an expensive phase
you know will fail — but only because it stops more than its name suggests.
Verify the state afterwards rather than assuming which of the two behaviours
you got.
