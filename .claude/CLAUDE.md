# CLAUDE.md — Agent Instructions for rapitas

## PRIORITY ORDER

When rules conflict, follow this order:

1. CRITICAL CONSTRAINTS (Section 1)
2. WORKFLOW (Section 4)
3. Everything else

---

## 1. CRITICAL CONSTRAINTS

### Never do these — no exceptions

- **Never stop or kill the backend server** (bun process, port 3001).
  The agent communicates with itself via this server. Killing it terminates the agent.
  Before killing any Node.js/bun process, verify it is NOT port 3001.

- **Never run `prisma generate` or `prisma db push` manually.**
  dev.js runs these automatically on startup. Running them manually requires a server restart, which severs the agent's own connection.
  If `schema.prisma` is modified, stop and instruct the user to restart the server.

- **Never write workflow files directly** (mkdir, Write tool, etc.).
  Always use the workflow API. (See Section 4.)

---

## 2. ARCHITECTURE

| Layer    | Stack                                     | Port |
| -------- | ----------------------------------------- | ---- |
| Frontend | Next.js 16 + Tailwind CSS v4 + TypeScript | 3000 |
| Backend  | Elysia + Bun + Prisma ORM + PostgreSQL    | 3001 |
| Desktop  | Tauri 2.x                                 | —    |

### Dev server startup (managed by `rapitas-desktop/scripts/dev.js`)

Automatically handles on each start:

1. Kill zombie processes on ports 3001/3000
2. `prisma db push --skip-generate`
3. `bun run db:generate`
4. Start backend and frontend

---

## 3. CODE QUALITY

### Hard rules

- No `any` type in TypeScript. If unavoidable, add `// HACK(agent): reason`.
- File size limit: 300–500 lines. Split before adding to an oversized file.
- Test coverage: ≥ 80% for all new code.
- All public functions require JSDoc/rustdoc. (See COMMENT_POLICY.md)

### Naming conventions

| Target                | Convention       | Example             |
| --------------------- | ---------------- | ------------------- |
| Classes               | PascalCase       | `AgentOrchestrator` |
| Functions / Variables | camelCase        | `assignTask`        |
| Constants             | UPPER_SNAKE_CASE | `MAX_TOKENS`        |
| Component files       | kebab-case       | `task-card.tsx`     |

### Commit message format

```
<type>(<scope>): <description under 50 chars>

<body — optional>

#<issue-number>
```

Types: `feat` `fix` `docs` `style` `refactor` `test` `chore`
Language: English only. Use imperative mood ("Add", not "Added").

---

## 4. WORKFLOW

### File structure

```
rapitas-backend/tasks/
└── [categoryId]/
    └── [themeId]/
        └── [taskId]/
            ├── research.md
            ├── question.md   (optional)
            ├── plan.md
            └── verify.md
```

If categoryId or themeId is unset, use `0`.

### Workflow API (use exclusively — never write files directly)

```bash
# Save a workflow file
curl -X PUT http://localhost:3001/workflow/tasks/{taskId}/files/{fileType} \
  -H 'Content-Type: application/json' \
  -d '{"content":"..."}'

# fileType: research | question | plan | verify

# Read all workflow files
curl http://localhost:3001/workflow/tasks/{taskId}/files

# Approve / reject plan
curl -X POST http://localhost:3001/workflow/tasks/{taskId}/approve-plan \
  -H 'Content-Type: application/json' \
  -d '{"approved": true}'

# Update status manually
curl -X PUT http://localhost:3001/workflow/tasks/{taskId}/status \
  -H 'Content-Type: application/json' \
  -d '{"status": "in_progress"}'
```

### Status transitions (automatic on file save)

```
draft → research_done → plan_created → [plan_approved] → in_progress → completed
```

| File saved  | Auto-transition                    |
| ----------- | ---------------------------------- |
| research.md | `research_done`                    |
| plan.md     | `plan_created` (awaiting approval) |
| verify.md   | `completed`                        |

### Step-by-step

#### Step 1 — Research (`research.md`)

Investigate and save before writing any code:

- Dependency map: what depends on the files to be changed
- Duplicate check: does similar functionality already exist
- Breaking change risk: backward compatibility, migrations needed
- Test strategy: what must be unit/integration tested

#### Step 1.5 — Questions (`question.md`) — optional

If the spec is unclear, save `question.md` and stop.
Resume only after the user answers.

#### Step 2 — Plan (`plan.md`)

Save a checklist-based plan. Status auto-transitions to `plan_created`.

Required sections:

- Task summary
- Implementation checklist (checkboxes, nested by component)
- Risk assessment
- Definition of done

**After saving plan.md — STOP. Do not implement until the user approves.**

#### Step 3 — Approval gate

Wait for the user to approve via the UI.
Status transitions: `plan_created` → `plan_approved` → `in_progress`.
Only then begin implementation.

#### Step 4 — Implementation (with safeguards)

**Stop and report immediately if any of the following occur:**

- A file not listed in plan.md needs to be changed
- A test fails and self-correction has failed 3 times
- A new design decision is required mid-implementation

Commit in logical units. Run tests after each unit.

#### Step 5 — Verification (`verify.md`)

Save after implementation is complete. Required sections:

- Changed files (new / modified, with line delta)
- Test results (unit / integration / E2E pass/fail counts)
- Plan checklist completion status and percentage
- Unresolved concerns (or "None")
- Performance impact

#### Step 6 — Commit, push, PR

Execute only if verify.md shows:

- All tests pass
- No unresolved concerns

```bash
git add .
git commit -m "<type>(<scope>): <description>\n\n#<issue>"
git push -u origin <branch>
gh pr create \
  --title "[#<issue>] <description>" \
  --body "## Summary\n...\n\nCloses #<issue>\n\n## Test steps\n..." \
  --base master
```

Report the PR URL to the user.

If verify.md has failures or unresolved concerns — do NOT commit/push/PR. Report to user.

---

## 5. GITHUB

- Remote: `https://github.com/takamurayuki`
- Use `gh` CLI for all GitHub operations.
- Branch naming: `feature/<issue-number>-short-description` or `bugfix/<issue-number>-short-description`
- `main` must always be deployable. Never push directly to `main`.
- PR must always be linked to an Issue (`Closes #<issue>`).
- Base branch for PRs: `master`

---

## 6. SECURITY

- Never commit secrets (API keys, passwords, tokens). Use environment variables.
- Never include secrets in log output or comments.
- Run `npm audit` / `bun audit` when adding new dependencies.

## 7. Comment Policy

@COMMENT_POLICY.md

## 8. Component Splitting Policy

@COMPONENT_SPLITTING_POLICY.md
