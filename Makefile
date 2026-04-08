# Makefile for rapitas
#
# A thin wrapper around the most common workflows. The actual logic lives in
# package.json scripts and the per-subproject toolchains; this file just gives
# them short, memorable names.
#
# Run `make help` to see all targets.

.DEFAULT_GOAL := help
.PHONY: help install dev dev-web dev-tauri dev-watch backend frontend desktop \
        check test test-backend test-frontend lint lint-fix format \
        build-web build-tauri \
        db-push db-generate db-studio db-migrate db-reset \
        version-check version-sync env-check \
        check-files check-todos \
        snapshot snapshot-write snapshot-diff \
        clean clean-deep clean-dry

## help: Show this message
help:
	@echo "Rapitas — common targets"
	@echo ""
	@awk 'BEGIN {FS = ": "} /^## / {sub(/^## /, ""); printf "  \033[36m%-18s\033[0m %s\n", substr($$0, 1, index($$0, ":")-1), substr($$0, index($$0, ":")+2)}' $(MAKEFILE_LIST)

# ─── Setup ─────────────────────────────────────────────────────────────────

## install: Install dependencies for all subprojects
install:
	npm run install:all

# ─── Dev ───────────────────────────────────────────────────────────────────

## dev: Run preflight check + start backend & frontend (web)
dev:
	npm run dev

## dev-web: Alias for `dev`
dev-web: dev

## dev-tauri: Start Tauri desktop dev environment (recommended)
dev-tauri:
	npm run dev:tauri

## dev-watch: Tauri dev with file watch
dev-watch:
	npm run dev:tauri:watch

## backend: Start only the backend (port 3001)
backend:
	npm run dev:backend

## frontend: Start only the frontend (port 3000)
frontend:
	npm run dev:frontend

## desktop: Start the Tauri desktop app
desktop:
	npm run tauri

# ─── Quality ───────────────────────────────────────────────────────────────

## check: Run preflight environment checks
check:
	npm run check

## test: Run all tests (backend + frontend)
test:
	npm run test:all

## test-backend: Run backend tests only
test-backend:
	cd rapitas-backend && bun test

## test-frontend: Run frontend tests only
test-frontend:
	cd rapitas-frontend && pnpm test

## lint: Run all linters
lint:
	npm run lint:all

## lint-fix: Auto-fix lint and format issues
lint-fix:
	npm run lint:fix

## format: Same as lint-fix
format: lint-fix

# ─── Build ─────────────────────────────────────────────────────────────────

## build-web: Build the web frontend (PostgreSQL mode)
build-web:
	npm run build:web

## build-tauri: Build the Tauri desktop app
build-tauri:
	npm run tauri:build

# ─── Database ──────────────────────────────────────────────────────────────

## db-push: Push Prisma schema to DB (development)
db-push:
	npm run prisma:push

## db-generate: Regenerate Prisma client
db-generate:
	npm run prisma:generate

## db-studio: Open Prisma Studio
db-studio:
	npm run prisma:studio

## db-migrate: Run prisma migrate dev
db-migrate:
	npm run prisma:migrate

## db-reset: Reset DB and re-apply migrations (DESTRUCTIVE)
db-reset:
	cd rapitas-backend && npx prisma migrate reset

# ─── Versioning ────────────────────────────────────────────────────────────

## version-check: Verify version is in sync across all manifests
version-check:
	npm run version:check

## version-sync: Sync all manifests to root package.json version
version-sync:
	npm run version:sync

## env-check: Validate rapitas-backend/.env against .env.example
env-check:
	npm run env:check

## check-files: Report files over 300 / 500 line limits
check-files:
	npm run check:files:warn

## check-todos: Aggregate TODO/FIXME/HACK/NOTE markers
check-todos:
	npm run check:todos

## snapshot: Print current bottleneck snapshot
snapshot:
	npm run snapshot

## snapshot-write: Write bottleneck snapshot to .baselines/
snapshot-write:
	npm run snapshot:write

## snapshot-diff: Diff current state against last snapshot
snapshot-diff:
	npm run snapshot:diff

# ─── Cleanup ───────────────────────────────────────────────────────────────

## clean: Remove build artifacts and caches (DESTRUCTIVE)
clean:
	node scripts/clean.cjs

## clean-deep: Also remove node_modules (DESTRUCTIVE)
clean-deep:
	node scripts/clean.cjs --deep

## clean-dry: Show what `make clean` would remove
clean-dry:
	node scripts/clean.cjs --dry-run
