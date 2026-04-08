# Runbook

Operational playbook for **common failures** in rapitas development. Each
entry: symptom → diagnosis → fix. Stay close to root causes; use the destructive
commands at the bottom of each section only as a last resort.

> If you encounter a new failure mode, add a section here. The runbook only
> stays useful if it grows.

---

## Quick reference

| Symptom | Section |
|---|---|
| Backend won't start, `EADDRINUSE :3001` | [§1 Port conflict](#1-port-conflict-30003001) |
| Frontend connects but API calls 500 | [§2 Backend crashed silently](#2-backend-crashed-silently) |
| `prisma generate` errors / type mismatch | [§3 Prisma client out of sync](#3-prisma-client-out-of-sync) |
| `Can't reach database server` | [§4 PostgreSQL not running](#4-postgresql-not-running) |
| Tauri build hangs on Windows | [§5 Bun + Playwright pipe hang](#5-bun--playwright-pipe-hang-windows) |
| `pnpm lint` fails on a file you didn't touch | [§6 Husky bypassed earlier](#6-husky-was-bypassed-on-an-earlier-commit) |
| `prisma db push` reports schema drift | [§7 Schema drift](#7-schema-drift-after-pulling-develop) |
| Workflow files (research.md / plan.md) missing | [§8 Workflow API not used](#8-workflow-files-missing-or-out-of-sync) |
| Tauri sidecar binary not found | [§9 Backend binary missing in CI](#9-backend-sidecar-binary-missing-in-tauri-build) |
| `make`/`npm` says scripts not found | [§10 Stale node_modules](#10-stale-node_modules-after-package-changes) |

---

## 1. Port conflict (3000/3001)

**Symptom:** `Error: listen EADDRINUSE: address already in use 0.0.0.0:3001`
(or `:3000`).

**Diagnosis:** A previous backend or frontend process did not exit cleanly.

**Fix:**
```bash
# Find the process
# macOS / Linux
lsof -ti:3001 | xargs kill -9
lsof -ti:3000 | xargs kill -9

# Windows (PowerShell)
Get-NetTCPConnection -LocalPort 3001 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

> ⚠️ **Read CLAUDE.md §1 first.** When working as an AI agent, killing port
> 3001 may sever your own connection to the workflow API. Verify the PID is
> NOT the agent's parent before killing.

The dev startup script (`rapitas-desktop/scripts/dev.js`) auto-cleans zombie
processes; if the cleanup fails, this manual step is the fallback.

---

## 2. Backend crashed silently

**Symptom:** Frontend loads, but every API call returns 500 / `Failed to fetch`.

**Diagnosis:** The backend process exited but the frontend kept running. Most
common causes: uncaught promise rejection, OOM in a worker, Prisma connection
loss.

**Fix:**
```bash
# Check backend logs
tail -n 200 rapitas-backend/logs/backend.log

# Restart only the backend
make backend
```

If the crash repeats, run with verbose logging:
```bash
cd rapitas-backend && DEBUG=* bun run dev
```

---

## 3. Prisma client out of sync

**Symptom:** TypeScript errors like `Property 'fooField' does not exist on
type 'PrismaClient'` after pulling.

**Diagnosis:** The schema changed but `prisma generate` was not re-run.

**Fix:**
```bash
make db-generate
# or manually:
cd rapitas-backend && bun run db:generate
```

> ⚠️ **CLAUDE.md §1:** AI agents must NOT run `prisma generate` or
> `prisma db push` manually. The dev script handles this; if you need a
> regen, restart the dev environment instead.

---

## 4. PostgreSQL not running

**Symptom:** `PrismaClientInitializationError: Can't reach database server at
localhost:5432`.

**Diagnosis:** PostgreSQL is not running, or `DATABASE_URL` is wrong.

**Fix:**
```bash
# Validate the .env first
make env-check

# Start PostgreSQL
# macOS (Homebrew)
brew services start postgresql@16

# Linux (systemd)
sudo systemctl start postgresql

# Windows (services manager)
net start postgresql-x64-16

# Verify
psql "$(grep DATABASE_URL rapitas-backend/.env | cut -d= -f2-)" -c '\l'
```

If `make env-check` reports the placeholder credentials warning, edit
`rapitas-backend/.env` and replace `user:password` with your actual DB user.

---

## 5. Bun + Playwright pipe hang (Windows)

**Symptom:** Screenshot worker hangs forever; Playwright never returns.

**Diagnosis:** Known Bun bug — `--remote-debugging-pipe` is broken in the Bun
runtime on Windows. Tracked at
[oven-sh/bun#23826](https://github.com/oven-sh/bun/issues/23826).

**Fix:** Already mitigated. Screenshot capture runs via a Node.js subprocess
(`screenshot-worker.cjs`), not directly under Bun. If you see this hang again,
verify the worker is being spawned via Node:
```bash
grep -r "screenshot-worker" rapitas-backend/services/screenshot/
```

If a new code path tries to call Playwright directly from Bun, route it
through the Node worker instead.

---

## 6. Husky was bypassed on an earlier commit

**Symptom:** `pnpm lint` or CI fails on a file you didn't touch in your PR.

**Diagnosis:** A previous commit landed with `--no-verify`, leaving lint
debt that lint-staged would have caught at commit time.

**Fix:**
```bash
# Auto-fix everything you can
make lint-fix

# Then commit only the fixes you understand
git add -p
git commit -m "chore(repo): fix lint debt from earlier bypass"
```

Do NOT use `--no-verify` to "make CI green" — that just kicks the can.

---

## 7. Schema drift after pulling develop

**Symptom:** `make dev` reports `Drift detected: Your database schema is not
in sync with your Prisma schema file`.

**Diagnosis:** Your local DB has columns/tables from a feature branch you
were testing earlier, but `develop` doesn't expect them.

**Fix (development DB only — not production):**
```bash
cd rapitas-backend
npx prisma migrate reset       # DESTRUCTIVE: wipes data
# or
npx prisma db push --force-reset
```

If you need the data, dump it first:
```bash
pg_dump -d rapitas > backup-$(date +%F).sql
```

> Once ADR-0003 (Prisma migration strategy) reaches Phase 2, drift handling
> will use `prisma migrate deploy` instead.

---

## 8. Workflow files missing or out of sync

**Symptom:** Agent reports `research.md` not found; status stuck at `draft`.

**Diagnosis:** Workflow files were written via the filesystem (mkdir / Write)
instead of the workflow API. CLAUDE.md §1 prohibits this — the API is the
only path that triggers status auto-transitions.

**Fix:**
```bash
# Re-save via the API
curl -X PUT http://localhost:3001/workflow/tasks/{taskId}/files/research \
  -H 'Content-Type: application/json' \
  -d '{"content":"<full content>"}'

# Verify
curl http://localhost:3001/workflow/tasks/{taskId}/files
```

If multiple files are out of sync, save them in the canonical order:
`research → plan → verify`.

---

## 9. Backend sidecar binary missing in Tauri build

**Symptom:** CI's `tauri-build` job fails with "binary not found at
`src-tauri/binaries/rapitas-backend-<target>`".

**Diagnosis:** `bun build --compile` failed silently, OR the post-build copy
step didn't run.

**Fix in CI:** The `tauri-build.yml` workflow already includes verification
steps (`Verify backend binary before configuration` for both Windows and
Unix). Read the job log for the listing of `src-tauri/binaries/`.

**Fix locally:**
```bash
cd rapitas-backend
bun build index.ts --compile --outfile rapitas-backend
mkdir -p ../rapitas-desktop/src-tauri/binaries
cp rapitas-backend ../rapitas-desktop/src-tauri/binaries/
```

---

## 10. Stale node_modules after package changes

**Symptom:** `Cannot find module 'X'` even though `package.json` lists it,
or peer-dependency warnings on every install.

**Fix:**
```bash
make clean-deep   # removes all node_modules
make install      # reinstall
```

If only the root tools are broken:
```bash
rm -rf node_modules package-lock.json
npm install
```

---

## Escalation

If none of the above resolves the issue:

1. **Search closed issues** at github.com/takamurayuki/rapitas/issues
2. **Check the most recent CI run** on `develop` to see if `develop` itself
   is broken
3. **Open an issue** with: symptom, exact command run, full error output,
   contents of `make env-check`, OS version
4. For **security issues**, do NOT open a public issue — see [SECURITY.md](../SECURITY.md)
