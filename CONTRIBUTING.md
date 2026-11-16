# Contributing to rapitas

Thanks for your interest in contributing. This document is the **shortest path
from a fresh clone to a merged PR**. For deeper context, see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`.claude/CLAUDE.md`](.claude/CLAUDE.md), and
[`docs/adr/`](docs/adr/).

> Working as an AI agent? Read [`.claude/CLAUDE.md`](.claude/CLAUDE.md) first — its workflow
> rules override anything in this file.

---

## 1. Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | 24 (see `.nvmrc`) | Frontend / desktop tooling |
| Bun | 1.3.13 | Backend runtime + compile |
| pnpm | 10.34.9 | Frontend / desktop package manager |
| PostgreSQL | 14+ | Web build database (the desktop build uses SQLite) |
| Rust | stable | Tauri builds |

The versions CI installs are pinned in
[`.github/toolchain.json`](.github/toolchain.json) — treat that file as the
source of truth. Three runtimes coexist intentionally — see
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

`npm run dev` runs `scripts/preflight-check.cjs` first; it checks the Node,
Bun and pnpm installs, the `.env` files, `node_modules`, that `DATABASE_URL`
is set, and whether ports 3000/3001 are free.

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
| `any` type | Forbidden (use `// HACK(agent): reason` + an eslint-disable directive if unavoidable) | ESLint (`@typescript-eslint/no-explicit-any` is an error in prod code, `eslint-shared.mjs`) |
| File size | ≤ 300 lines (hard limit 500) | `scripts/check-large-files.cjs` (`File Size Check` workflow, ratcheted against a baseline) + review (see `.claude/COMPONENT_SPLITTING_POLICY.md`) |
| Dir size | ≤ 10 files (hard limit 20) | review (see `.claude/FOLDER_ORGANIZATION_POLICY.md`) |
| Public function docs | Required (JSDoc / rustdoc) | review (see `.claude/COMMENT_POLICY.md`) |
| Comments | WHY, not WHAT | review (see `.claude/COMMENT_POLICY.md`) |
| Docs: no emoji, no box-drawing diagrams | See "Documentation style" below | `scripts/docs/check-docs-style.cjs` (CI step `Docs follow the style rules`) |
| Docs: paths, scripts, versions match the code | See "Documentation style" below | `scripts/docs/check-docs-drift.cjs` (CI step `Docs match the code`) |

### Documentation style

Docs describe the code as it is today. A PR that changes behaviour updates the
docs it affects in the same PR. Write in the doc's language (Japanese or
English) and keep it plain:

- **Structure.** Short noun-phrase headings with no decoration. The first
  sentence of a section states its conclusion or purpose.
- **Status as words.** Tables say 対応済み / 未対応 / 一部 (or Done / Not done).
  Task lists use `- [ ]` / `- [x]`.
- **Callouts.** Use GitHub alerts — `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`,
  `> [!WARNING]`, `> [!CAUTION]` — not emoji.
- **Examples.** Label them Good / Bad (良い例 / 悪い例), not with check marks.
- **Shape.** Comparisons and options as tables, procedures as numbered lists,
  parallel items as bullets.
- **Tone.** Bold only key terms or the one thing not to miss. No exclamation
  marks, no closing pleasantries, no repeated summary sections. One idea per
  sentence, short paragraphs, the same term for the same thing.
- **Diagrams.** Flows, sequences, states and architecture are ```` ```mermaid ````
  blocks. Directory trees stay plain text trees.

CI enforces the mechanical part: `scripts/docs/check-docs-style.cjs` fails on
emoji or emoji-style marks and on box-drawing diagrams in any tracked Markdown
outside `docs/archive/`. A symbol that is literal UI or tool output can be
allow-listed in `scripts/docs/docs-style-ignore.json`, with a reason.

---

## 6. Testing

```bash
make test            # all tests (backend + frontend)
make test-backend    # bun test
make test-frontend   # vitest
```

Coverage targets are managed via a stepwise ratchet — see
[ADR 0002](docs/adr/0002-coverage-gate-staging.md). The enforced frontend
thresholds live in `rapitas-frontend/vitest.config.ts` (`coverage.thresholds`);
new PRs that meaningfully drop coverage will be
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
4. **Wait for CI to pass.** Which checks block a merge is defined in one
   place, [`.github/quality-gates.json`](.github/quality-gates.json) (entries
   with `"mode": "required"`). Today they are:
   - the test and lint jobs in `test-lint.yml` (Lint Code, Check Frontend,
     Check Rust Code on Linux and Windows, Test Backend, Test SQLite
     Compatible Suite, Route Regression, Frozen Install Verification)
   - `Build (ubuntu-latest)`, `Build (macos-latest)`, `Build (windows-latest)`
     from `tauri-build.yml`
   - the security scan jobs from `security-scan.yml` (CodeQL Analysis,
     Dependency Security Check, NPM Security Audit, Rust Security Audit)
   - `Secret scanning` from `gitleaks.yml`

   `Version Sync Check` and the Markdown lint are advisory.
5. **Mark "Ready for review"** and request a code owner (see `.github/CODEOWNERS`).
6. **Squash-merge into `develop`.** `main` is the release line; there is no `master`.

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

- **Architecture / design questions** — open an issue tagged `question`
- **Bug reports** — issue with the bug report template
- **Feature ideas** — issue with the feature request template
- **AI agent workflow questions** — read `.claude/CLAUDE.md` first; if unclear, file
  an issue tagged `agent-workflow`

Welcome aboard.
