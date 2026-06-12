# FOLDER ORGANIZATION POLICY

## PRIME DIRECTIVE

Keep every directory shallow and navigable.
If a directory has more than 10 files at its root, split by domain or concern.

---

## 1. DECISION TREE — Should I reorganize?

```
Does the directory have > 10 files at root level?
├── YES → Split into subdirectories by domain/concern. (See Section 2)
└── NO  → Are the files from multiple unrelated domains?
           ├── YES → Split by domain. (See Section 2)
           └── NO  → Leave as-is.
```

---

## 2. DIRECTORY SIZE LIMITS

| File count at root | Action                                              |
| ------------------ | --------------------------------------------------- |
| ≤ 10 files         | OK — no action required                             |
| 11–20 files        | Split at next edit — do not add files without splitting |
| > 20 files         | Must split before any other changes                 |

---

## 3. HOW TO ORGANIZE

### 3-1. Backend Services (`services/`)

Group by domain. Each subdirectory must have a barrel `index.ts`.

```
services/
├── task/                    # task-related services
│   ├── index.ts
│   ├── task-service.ts
│   └── task-mutations.ts
├── scheduling/              # time/schedule-related services
│   ├── index.ts
│   ├── pomodoro-service.ts
│   └── recurrence-service.ts
├── communication/           # realtime, websocket, notification
│   ├── index.ts
│   └── ...
├── agents/                  # already organized
│   └── ...
└── [existing subdirectories remain]
```

### 3-2. Backend Utils (`utils/`)

Group by concern. Each subdirectory must have a barrel `index.ts`.

```
utils/
├── agent/                   # agent-related utilities
│   ├── index.ts
│   └── ...
├── database/                # DB helpers, Prisma optimization
│   ├── index.ts
│   └── ...
├── common/                  # general-purpose utilities
│   ├── index.ts
│   └── ...
└── [existing subdirectories remain]
```

### 3-3. Backend Routes (`routes/`)

Already well-organized. When a route subdirectory exceeds 10 files,
split further by sub-concern (e.g., `routes/agents/crud/`, `routes/agents/monitoring/`).

### 3-4. Frontend Components (`components/`)

Group loose files into feature-based subdirectories with barrel exports.

```
components/
├── providers/               # React context providers
│   ├── index.ts
│   └── ...
├── widgets/                 # dashboard widgets and charts
│   ├── index.ts
│   └── ...
├── notifications/           # notification UI
│   ├── index.ts
│   └── ...
├── settings/                # settings panels
│   ├── index.ts
│   └── ...
├── common/                  # shared utility components
│   ├── index.ts
│   └── ...
└── [existing subdirectories remain]
```

### 3-5. Frontend Hooks (`hooks/`)

Group by domain. Each subdirectory must have a barrel `index.ts`.

```
hooks/
├── task/                    # task-related hooks
│   ├── index.ts
│   └── ...
├── workflow/                # workflow hooks
│   ├── index.ts
│   └── ...
├── ui/                      # UI behavior hooks
│   ├── index.ts
│   └── ...
├── common/                  # general-purpose hooks
│   ├── index.ts
│   └── ...
└── [existing subdirectories remain]
```

### 3-6. Next.js App Directory (`app/`)

Use underscore-prefixed private folders for non-route files.

```
app/feature-name/
├── page.tsx                 # route entry point
├── _components/             # page-specific components
│   └── ...
├── _hooks/                  # page-specific hooks
│   └── ...
└── _types/                  # page-specific types (if needed)
    └── ...
```

**Rules:**

- Only `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx` remain at directory root.
- Barrel files (`index.ts`) stay at root if they serve as re-exports.
- Underscore prefix (`_`) prevents Next.js from treating them as routes.

---

## 4. BARREL EXPORT RULES

Every new subdirectory must include an `index.ts` that re-exports its public API.

```typescript
// services/task/index.ts
export { taskService } from './task-service';
export { createTask, updateTask } from './task-mutations';
```

**Rules:**

- New code: import from the specific file or subdirectory barrel.
- Existing code: may continue importing from old paths during migration.
- After migration: update all imports in the same commit.
- Never create circular imports between barrel files.

---

## 5. NAMING CONVENTIONS

| Target                | Convention  | Example                     |
| --------------------- | ----------- | --------------------------- |
| Subdirectory names    | kebab-case  | `agent-execution/`          |
| Barrel files          | `index.ts`  | `index.ts`                  |
| Private app folders   | `_name`     | `_components/`              |

---

## 6. WHEN NOT TO REORGANIZE

- **Generated directories** (e.g., `node_modules/`, `.next/`, `prisma/migrations/`).
- **Directories with ≤ 10 files** that share a single domain.
- **Test directories** (`__tests__/`) — keep tests co-located with their subjects.
- **Config directories** (`config/`, `middleware/`) — typically small and stable.

---

## QUICK REFERENCE

```
Directory > 20 files?        → Split immediately, no exceptions
Directory 11-20 files?       → Split at next edit
Multiple unrelated domains?  → Split by domain
New subdirectory?            → Add barrel index.ts
App directory non-route?     → Use _components/, _hooks/ prefix
```
