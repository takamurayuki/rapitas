# COMPONENT SPLITTING POLICY

## PRIME DIRECTIVE

Split by responsibility first.

- 1 component = 1 visual concern OR 1 behavioral concern
- 1 function = 1 intent
- 1 file ≤ 300 lines (hard limit: 500 lines)

---

## 1. DECISION TREE — Should I split?

```
Does the file exceed 300 lines?
├── YES → Split immediately. (See Section 2)
└── NO  → Does the file have multiple responsibilities?
           ├── YES → Split by responsibility. (See Section 3)
           └── NO  → Leave as-is.
```

---

## 2. FILE SIZE LIMITS

| Range       | Action                                           |
| ----------- | ------------------------------------------------ |
| ≤ 300 lines | OK — no action required                          |
| 301–500     | Split at next edit — do not add lines without splitting |
| > 500       | Must split before any other changes              |

**Line count includes all lines** (code, comments, blank lines, imports).

---

## 3. HOW TO SPLIT

### 3-1. React Components (`.tsx`)

Split into the following structure:

```
components/
└── feature-name/
    ├── index.ts              # re-exports public API
    ├── feature-name.tsx      # main component (orchestrator)
    ├── feature-name-header.tsx
    ├── feature-name-list.tsx
    ├── feature-name-item.tsx
    ├── use-feature-name.ts   # custom hook (state + logic)
    ├── feature-name.types.ts # types/interfaces
    └── feature-name.utils.ts # pure helper functions
```

**Rules:**

- The main component file orchestrates child components — it should contain minimal logic.
- Extract custom hooks when state logic exceeds ~30 lines.
- Extract sub-components when JSX blocks exceed ~50 lines or are conditionally rendered.
- Use `index.ts` with re-exports to keep import paths clean.

### 3-2. Backend Routes / Routers (`.ts`)

Split into the following structure:

```
routes/
└── feature/
    ├── index.ts              # re-exports the router
    ├── feature-router.ts     # route definitions only (thin layer)
    ├── feature-handlers.ts   # request handlers
    ├── feature-service.ts    # business logic
    ├── feature-validators.ts # input validation schemas
    └── feature.types.ts      # types/interfaces
```

**Rules:**

- Route files should only define routes and delegate to handlers.
- Handlers should validate input then delegate to services.
- Services contain business logic and database queries.

### 3-3. Type Files (`.types.ts`, `types/index.ts`)

Split by domain:

```
types/
├── index.ts         # re-exports all types (backward compatibility)
├── task.types.ts
├── agent.types.ts
├── workflow.types.ts
└── ui.types.ts
```

**Rules:**

- Group types by the domain entity they describe.
- Always maintain a barrel `index.ts` that re-exports everything for backward compatibility.
- Import from specific files in new code; legacy imports from `index.ts` remain valid.

### 3-4. Utility / Helper Files

Split by concern:

```
utils/
├── index.ts           # re-exports
├── date-utils.ts
├── string-utils.ts
├── validation-utils.ts
└── api-utils.ts
```

### 3-5. Test Files (`.test.ts`, `.spec.ts`)

Split by test suite when exceeding 300 lines:

```
__tests__/
├── feature.unit.test.ts
├── feature.integration.test.ts
└── feature.edge-cases.test.ts
```

Or by the module under test:

```
feature-handlers.test.ts
feature-service.test.ts
feature-validators.test.ts
```

---

## 4. NAMING CONVENTIONS

| Target             | Convention  | Example                     |
| ------------------ | ----------- | --------------------------- |
| Component files    | kebab-case  | `task-card-header.tsx`      |
| Hook files         | kebab-case  | `use-task-actions.ts`       |
| Type files         | kebab-case  | `task.types.ts`             |
| Util files         | kebab-case  | `date-utils.ts`             |
| Test files         | kebab-case  | `task-card.test.tsx`        |
| Index/barrel files | `index.ts`  | `index.ts`                  |

---

## 5. IMPORT RULES AFTER SPLITTING

- **New code**: Import from the specific sub-module file.
- **Existing code**: May continue importing from `index.ts` barrel files.
- **Never** create circular imports. If A imports B, B must not import A.
- After splitting, update all imports in the same commit to avoid broken intermediate states.

---

## 6. WHEN NOT TO SPLIT

- **Generated files** (e.g., Prisma client, icon registries from codegen) — these are maintained by tools.
- **Configuration files** (e.g., `next.config.ts`, `tailwind.config.ts`).
- **Migration files** — never modify after creation.
- **Single-purpose utility files** under 300 lines that would produce files under 50 lines each if split.

---

## QUICK REFERENCE

```
File > 500 lines?          → Split immediately, no exceptions
File 301-500 lines?        → Split at next edit
Multiple responsibilities? → Split by responsibility
Component > 50 lines JSX?  → Extract sub-component
Hook > 30 lines logic?     → Extract custom hook
Route + handler + service? → Separate files
Types from multiple domains? → Split by domain
```
