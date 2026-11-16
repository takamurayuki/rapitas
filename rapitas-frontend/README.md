# rapitas-frontend

The Rapitas web UI: Next.js 16 (App Router) + React 19 + Tailwind CSS v4 +
TypeScript. It talks to `rapitas-backend` over HTTP/SSE on port 3001; the
desktop app (`rapitas-desktop`) loads a static export of this package.

For whole-repo setup see [docs/SETUP.md](../docs/SETUP.md); for the system
map see [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).

## Run

Start the backend (port 3001) first, then:

```bash
pnpm run dev            # next dev on http://127.0.0.1:3000 (clears .next when deps changed)
pnpm run dev:no-check   # plain next dev, no cache check
pnpm run dev:clean      # force-clear .next, then dev
```

`predev`, `prebuild` and `pretest` regenerate the i18n message bundle and the
agents panel registry (`scripts/generate-messages.mjs`,
`scripts/generate-agents-panels.mjs`).

## Test and check

```bash
pnpm test               # vitest run
pnpm run test:coverage  # vitest run --coverage (thresholds in vitest.config.ts)
pnpm exec vitest run src/path/to/file.test.tsx   # one file
pnpm exec tsc --noEmit
pnpm run lint           # eslint
pnpm run prettier:check
```

## Build

```bash
pnpm run build          # next build (web)
pnpm run build:tauri    # TAURI_BUILD=true static export for the desktop app
```

## Layout (`src/`)

| Path | Contents |
| --- | --- |
| `app/` | App Router routes; page-private code lives in `_components/`, `_hooks/` |
| `components/` | Shared components (`components/ui/` for reusable primitives) |
| `feature/` | Feature folders (tasks, calendar, search, settings modal, terminal, …) |
| `hooks/` | Shared hooks |
| `stores/` | zustand stores |
| `contexts/` | React context providers |
| `lib/` | API clients and pure utilities (`lib/sse/` for the shared SSE client) |
| `i18n/` | next-intl config; catalogs are in `messages/` (`en.json`, `ja.json`, `fragments/`) |
| `styles/` | CSS for the note editor and note modal (the Tailwind entry and global styles are `app/globals.css`) |
| `config/` | Shared configuration (for example `benign-error-patterns.ts`) |
| `data/` | Static UI data (achievement definitions) |
| `types/` | Shared TypeScript types |
| `utils/` | Shared utilities |
