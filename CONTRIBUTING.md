# Contributing to rapitas

Thanks for your interest in contributing. This document is the **shortest path
from a fresh clone to a merged PR**. For deeper context, see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`CLAUDE.md`](CLAUDE.md), and
[`docs/adr/`](docs/adr/).

> Working as an AI agent? Read [`CLAUDE.md`](CLAUDE.md) first — its workflow
> rules override anything in this file.

---

## 1. Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | 20.x (see `.nvmrc`) | Frontend / desktop tooling |
| Bun | 1.1.42+ | Backend runtime + compile |
| pnpm | latest | Frontend / desktop package manager |
| PostgreSQL | 14+ | Primary database |
| Rust | stable | Tauri builds |

Three runtimes coexist intentionally — see
[ADR 0001](docs/adr/0001-three-runtimes-coexistence.md).

---

## 2. Local setup

```bash
git clone https://github.com/takamurayuki/rapitas.git
cd rapitas

# Install everything
npm run install:all
# or: make install

# Set up backend env
cp rapitas-backend/.env.example rapitas-backend/.env
# Edit DATABASE_URL and (optionally) AI provider keys

# Start the recommended dev environment
make dev-tauri
# or: cd rapitas-desktop && node scripts/dev.js
```

`scripts/preflight-check.cjs` runs first and validates Node, Bun, pnpm,
PostgreSQL connectivity, and that ports 3000/3001 are free.

---

## 3. Branch naming

```
feature/<issue>-short-description    # new functionality
bugfix/<issue>-short-description     # bug fixes
chore/<issue>-short-description      # tooling, deps, refactors with no behavior change
docs/<issue>-short-description       # docs only
```

Always link to an issue. PRs without `Closes #N` are flagged in review.

---

## 4. Commit messages

We follow **Conventional Commits**, enforced by commitlint via husky.

```
<type>(<scope>): <subject ≤ 72 chars>

<body — optional, wraps freely>

#<issue-number>
```

### Allowed types
`feat` `fix` `docs` `style` `refactor` `perf` `test` `chore` `ci` `revert`

### Allowed scopes (warning, not error)
See [`commitlint.config.js`](commitlint.config.js). Most common:
- Apps: `frontend`, `backend`, `desktop`, `tauri`
- Cross-cutting: `repo`, `ci`, `docs`, `deps`, `config`, `scripts`
- Backend domains: `tasks`, `agents`, `workflow`, `auth`, `prisma`, `db`, `api`, `ai`, `memory`, `github`, `schedule`
- Frontend domains: `ui`, `editor`, `voice`, `kanban`, `calendar`, `pomodoro`, `i18n`, `theme`

### Rules
- **English only**, imperative mood ("Add", not "Added")
- Scope must be **kebab-case**
- Body explains **why**, not what (the diff shows what)

---

## 5. Code style

| Topic | Rule | Enforced by |
|---|---|---|
| Formatting | Prettier defaults | `lint-staged` on commit |
| TS rules | ESLint + `@typescript-eslint` | `lint-staged` + CI |
| `any` type | Forbidden (use `// HACK(agent): reason` if unavoidable) | review |
| File size | ≤ 300 lines (hard limit 500) | review (see `COMPONENT_SPLITTING_POLICY.md`) |
| Dir size | ≤ 10 files (hard limit 20) | review (see `FOLDER_ORGANIZATION_POLICY.md`) |
| Public function docs | Required (JSDoc / rustdoc) | review (see `COMMENT_POLICY.md`) |
| Comments | WHY, not WHAT | review (see `COMMENT_POLICY.md`) |

---

## 6. Testing

```bash
make test            # all tests (backend + frontend)
make test-backend    # bun test
make test-frontend   # vitest
```

Coverage targets are managed via a stepwise ratchet — see
[ADR 0002](docs/adr/0002-coverage-gate-staging.md). At time of writing the
frontend gate is **15%**; new PRs that meaningfully drop coverage will be
asked to add tests.

For new features, prioritize tests in this order:
1. Pure functions in `lib/` and `utils/`
2. Backend services (`services/task/`, `services/workflow/`, …)
3. React hooks
4. Routes / handlers (integration tests)
5. UI components (last)

---

## 7. Pre-commit hooks

`husky` + `lint-staged` runs Prettier and ESLint on staged files. If a hook
fails:

1. **Read the error.** Most are auto-fixed; you just need to `git add` again.
2. **Do not use `--no-verify`** unless explicitly needed (e.g., emergency
   revert). Bypassed hooks are flagged in review.
3. See [`docs/pre-commit-guide.md`](docs/pre-commit-guide.md) for the full
   self-healing flow.

---

## 8. Pull request flow

1. **Create an issue first** if one doesn't exist. PRs without an issue need
   strong justification.
2. **Open a draft PR early** so CI runs against your branch.
3. **Fill in the PR template** completely. The "test plan" section is not
   optional.
4. **Wait for CI to pass.** The hard gates are:
   - `Test and Lint` (test-lint.yml)
   - `Version Sync Check` (version-check.yml)
   - `Tauri Build` if you touched the Tauri pipeline
   - `Security Scan` if you touched dependencies
5. **Mark "Ready for review"** and request a code owner (see `.github/CODEOWNERS`).
6. **Squash-merge into `develop`.** `master` is reserved for releases.

---

## 9. Releases

Releases are **tag-driven**. To cut one:

```bash
# 1. Bump the version in root package.json
# 2. Sync all manifests
make version-sync

# 3. Verify everything is in sync
make version-check

# 4. Commit, tag, push
git commit -am "chore(repo): release v1.2.3"
git tag v1.2.3
git push origin develop --tags
```

The `tauri-build.yml` workflow then builds Windows / macOS (Intel + ARM) /
Linux artifacts and creates a GitHub Release.

---

## 10. Reporting security issues

Do **not** open a public issue. Use GitHub's **Private vulnerability reporting**
on the Security tab. See [`SECURITY.md`](SECURITY.md) for details.

---

## 11. Where to ask questions

- **Architecture / design questions** — open a GitHub Discussion
- **Bug reports** — issue with the bug report template
- **Feature ideas** — issue with the feature request template
- **AI agent workflow questions** — read `CLAUDE.md` first; if unclear, file
  an issue tagged `agent-workflow`

Welcome aboard.
