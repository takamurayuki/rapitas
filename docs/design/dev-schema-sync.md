# Dev database schema synchronization

> How the **development database** schema is kept in sync with `prisma/schema`
> across the two dev launchers, why it is provider-aware, and the silent-drift
> bugs this design fixed (2026-05-29).

This document covers **development only**. Production migration strategy lives
in [ADR-0003](../adr/0003-prisma-migration-strategy.md); the multi-file schema
layout lives in [ADR-0006](../adr/0006-prisma-schema-folder-split.md).

---

## TL;DR

- `prisma/schema/` is the **single source of truth** (PostgreSQL provider).
- `prisma/schema.desktop/` is a **generated artifact** — a SQLite copy produced
  by `scripts/generate-sqlite-prisma-schema.cjs` (provider swapped to `sqlite`,
  `@db.Decimal(...)` stripped). **Never hand-edit it; edit `prisma/schema/`.**
- There are **two dev launchers** with **different sync mechanisms**, and a
  column added to an existing table must be applied by *both*:

| Launcher | DB | Schema applied by |
|---|---|---|
| `rapitas-backend/scripts/dev.ts` (`bun run dev`) | PostgreSQL **or** local SQLite | `prisma db push` (provider-aware) |
| `rapitas-desktop/scripts/dev.js` (`dev:tauri`) | `rapitas-desktop/.data/rapitas-dev.db` (SQLite) | generated init SQL + **startup self-heal** (no `prisma db push`) |

---

## Launcher A — backend dev watcher (`scripts/dev.ts` + `dev/watcher.ts`)

Provider resolution (`scripts/dev/prisma-sync.ts → resolveDbProvider`) mirrors
`prisma.config.ts`: explicit `RAPITAS_DB_PROVIDER` wins; else a `file:`
`DATABASE_URL` ⇒ `sqlite`; else ⇒ `postgresql`.

`syncDevSchema()` then runs, pinning `RAPITAS_DB_PROVIDER` on the CLI:

- **SQLite**: regenerate `schema.desktop` → `db push --skip-generate` → (generate)
- **PostgreSQL**: `db push --skip-generate` → (generate)

Triggers: startup (`dev.ts`, push only) and any `prisma/schema/*.prisma` save
(`watcher.ts`, full regenerate→push→generate→restart).

## Launcher B — desktop/Tauri (`rapitas-desktop/scripts/dev.js`)

This is the launcher CLAUDE.md §2 refers to as "managed by dev.js". It:

- sets `RAPITAS_DB_PROVIDER=sqlite` and an **absolute** `DATABASE_URL=file:<repo>/rapitas-desktop/.data/rapitas-dev.db`,
- runs `bun run db:prepare:sqlite` = regenerate the init SQL
  (`generate-sqlite-init-sql.cjs`) + `prisma generate --schema prisma/schema.desktop`.

**It never runs `prisma db push`.** The schema is materialized at server
startup by `config/desktop-sqlite.ts → ensureDesktopSqliteDatabase()`, which
runs the generated `SQLITE_INIT_SQL` and self-heals the live DB against it.

---

## The bugs this fixed (2026-05-29)

**Symptom:** After adding `Task.goals/constraints/acceptanceCriteria` to
`prisma/schema/`, every `prisma.task.*` call returned HTTP 500:
`The column main.Task.goals does not exist in the current database`.
(`main.*` ⇒ SQLite.) The Prisma client *knew* the column (its SQL referenced
it); only the DB table lacked it.

### Launcher A bug

`dev.ts` ran a bare `bunx prisma db push` with no provider. With a `file:`
`DATABASE_URL`, `prisma.config.ts` defaulted to the **PostgreSQL** schema; the
provider/URL mismatch failed the push, and the non-zero exit was **swallowed**
(`await pushResult.exited` ignored the code). The SQLite path also never
regenerated `schema.desktop`. → Fixed by `scripts/dev/prisma-sync.ts`
(provider-aware, regenerates `schema.desktop`, checks every exit code, logs a
loud actionable error).

### Launcher B bug (the one actually hit here)

`dev.js` applies schema only via the init-SQL self-heal, which used
`CREATE TABLE IF NOT EXISTS` semantics — it created **missing tables** but
**never `ALTER`ed an existing table to add a new column**. So `Task.goals`
never appeared on the already-existing dev DB. → Fixed by extending
`ensureDesktopSqliteDatabase()` with a **column-level self-heal**
(`addMissingColumns` / `parseColumnDefs`): for each table that already exists,
diff the init-SQL column list against `PRAGMA table_info` and
`ALTER TABLE ADD COLUMN` the additive delta. Failures (e.g. a NOT NULL column
without a constant default) are logged and skipped, mirroring the index
self-heal. Covered by `tests/config/desktop-sqlite-self-heal.test.ts`.

This is the column-level analogue of the earlier missing-table self-heal added
after the `WorkflowTransition` incident — same pattern, finer granularity.

### One-time recovery for an already-drifted dev DB

The columns are nullable, so a direct additive `ALTER` is safe and needs no
restart (the running client already knows them). For the desktop DB:

```bash
bun -e "const {Database}=require('bun:sqlite'); const db=new Database('rapitas-desktop/.data/rapitas-dev.db'); for (const c of ['goals','constraints','acceptanceCriteria']) { try { db.run('ALTER TABLE \"Task\" ADD COLUMN \"'+c+'\" TEXT'); } catch {} }"
```

(After this fix landed, a normal server restart self-heals it automatically.)

---

## Invariants for future editors

- **Never hand-edit `prisma/schema.desktop/`** — regenerated from `prisma/schema/`.
- **Never add a bare `prisma db push`/`generate`** to `scripts/dev.ts` /
  `watcher.ts`. Route it through `syncDevSchema()` so the provider is pinned and
  failures are loud.
- When you add a **column** the desktop flow relies on the startup self-heal —
  ensure `generate-sqlite-init-sql.cjs` has been run so `SQLITE_INIT_SQL`
  contains it; the self-heal `ALTER`s it onto existing DBs on next start.
- `resolveDbProvider()` and `prisma.config.ts` **must stay in lockstep**.
