# Setup & Development

Operational guide for running rapitas locally. For *what rapitas is and why*, see the [README](../README.md).

## Prerequisites

Versions below are the ones CI installs; the single source of truth is [`.github/toolchain.json`](../.github/toolchain.json) (Node also in [`.nvmrc`](../.nvmrc)).

- **Node.js** 24
- **Bun** 1.3.13: `curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.13"`
- **pnpm** 10.34.9 (frontend / desktop): `npm i -g pnpm@10.34.9`
- **Rust + rustup** (stable toolchain) — required by the Tauri desktop build: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- **Git**
- **PostgreSQL** v14+ — only for the Web build; the desktop build uses bundled SQLite

## First-time setup

### Desktop build (SQLite) — recommended

```bash
npm run setup:desktop
```

Automatically: sets `DATABASE_URL=file:./dev.db`, generates `ENCRYPTION_KEY` / `ADMIN_SECRET`, installs all dependencies, and prepares the SQLite init scripts.

### Web build (PostgreSQL)

```bash
npm run setup            # interactive
npm run setup:skip-db    # skip DB init (configure later)
```

Runs a prerequisite check (Node/Bun/pnpm/PostgreSQL), installs dependencies, creates `.env` from `.env.example`, and runs `prisma generate` + `db push`.

### Manual setup

```bash
npm run install:all
cp rapitas-backend/.env.example rapitas-backend/.env   # edit DATABASE_URL etc.
cd rapitas-backend && npx prisma generate && npx prisma db push
```

## Quick start

### Integrated dev environment (recommended)

```bash
cd rapitas-desktop && node scripts/dev.js          # stable mode (AI-agent friendly)
cd rapitas-desktop && node scripts/dev.js --watch  # backend hot reload
```

`dev.js` runs the desktop (SQLite) stack. It handles: pinning the checkout to the primary branch and fast-forwarding it to its upstream (`rapitas-desktop/scripts/dev-pull.cjs`; skipped with a printed reason when the tree is dirty, diverged or offline; `--no-pull` turns it off), port-conflict cleanup (3000/3001), SQLite init SQL + Prisma client generation (`bun run db:prepare:sqlite`, cached when the schema is unchanged; the backend applies the init SQL on boot), and starting backend + frontend together.

`cd rapitas-backend && bun run dev` (web / PostgreSQL) runs `prisma db push --skip-generate` + `prisma generate` for the active provider before starting (`rapitas-backend/scripts/dev/prisma-sync.ts`).

### Web only

```bash
npm run dev             # preflight check + web dev servers
npm run dev:skip-check  # skip preflight (faster, after first run)
npm run check           # preflight only
```

`--kill-others-on-fail`: if either side fails to start, the other is stopped too.

### Individual processes (advanced)

> Start the backend (port 3001) **before** the frontend, or API calls will error.

```bash
cd rapitas-backend && bun run dev      # backend
cd rapitas-frontend && pnpm run dev    # frontend (separate terminal)
cd rapitas-desktop && npm run tauri    # desktop app (separate terminal)
```

## Access URLs

- Frontend (web): http://localhost:3000
- Backend API: http://localhost:3001
- Prisma Studio: http://localhost:5555 (`cd rapitas-backend && bun run db:studio`)
- Desktop app: launched by `rapitas-desktop/scripts/dev.js`

## Common commands

```bash
# Dev
cd rapitas-desktop && node scripts/dev.js   # integrated (recommended)
npm run dev:backend                         # backend only
npm run dev:frontend                        # frontend only
npm run dev:tauri[:watch]                   # tauri from repo root

# Database (backend)
cd rapitas-backend
npx prisma db push          # sync schema (dev) — the project uses db push only, no migration history (see ADR-0003)
bun run db:generate         # regenerate client
bun run db:studio           # GUI

# Desktop
cd rapitas-desktop
npm run tauri               # dev
npm run tauri:only          # app only (no dev server)
npm run build               # production build

# Tests & quality
npm run test:all            # backend + frontend tests
npm run lint:all            # all linters
cd rapitas-frontend && pnpm test
cd rapitas-backend && bun test
```

## Database

- ORM: Prisma 6 (`prismaSchemaFolder` layout under `prisma/schema/` — see [ADR-0006](adr/0006-prisma-schema-folder-split.md))
- Desktop: SQLite (`schema.desktop` is generated from the Postgres schema — never hand-edit; see [dev-schema-sync](design/dev-schema-sync.md))
- Web: PostgreSQL 14+

`rapitas-backend/.env` (web):

```env
DATABASE_URL="postgresql://user:password@localhost:5432/rapitas"
ANTHROPIC_API_KEY="..."   # or configure provider keys in-app (encrypted at rest)
OPENAI_API_KEY="..."
ENCRYPTION_KEY="..."      # encrypts API keys at rest in the DB; auto-generated into the OS keychain if unset
ADMIN_SECRET="..."        # required in production for /agents/shutdown, /agents/restart, /agents/diagnose
```

See `rapitas-backend/.env.example` for the full, authoritative list of variables.

`REDIS_URL` is not in `.env.example`: it is read only by `rapitas-backend/services/core/cache-service.ts`, which uses Redis (falling back to `redis://localhost:6379`) only when `NODE_ENV=production`; development uses the in-memory cache.

## Troubleshooting

```bash
# Port conflict (3000/3001)
lsof -ti:3000 | xargs kill -9        # macOS/Linux
# (Windows) dev.js reclaims ports automatically on startup

# Prisma schema sync error
cd rapitas-backend && npx prisma db push   # add --force-reset to wipe and recreate a dev DB

# Tauri build error
rustup update && cd rapitas-desktop && npm run ci:prepare
```

Health check: `http://localhost:3001/agents/health` (there is no root `/health` route — it lives under the `agents` router).

## Contributing / pre-commit

Commits run an auto-fix pre-commit hook (lint-staged → Prettier + ESLint, auto-restage, re-check). Details: [docs/pre-commit-guide.md](pre-commit-guide.md).

- Branch naming: `feature/<issue>-desc` / `bugfix/<issue>-desc`
- Conventional Commits (enforced by commitlint); TypeScript strict; new code ships with tests (≥ 80% coverage is the long-term target, not today's gate — see ADR-0002)
- Agent operating rules: [.claude/CLAUDE.md](../.claude/CLAUDE.md) and [AGENTS.md](../AGENTS.md)
