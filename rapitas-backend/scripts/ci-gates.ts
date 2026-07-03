/**
 * ci-gates.ts
 *
 * Typed registry of CI gate definitions for the rapitas-backend project.
 * To add a new gate: append one entry to GATES (and optionally create a .txt manifest).
 * The gate runner (scripts/run-gate.ts) resolves gates by id at execution time.
 *
 * Gate kinds:
 *   'test-suite' — runs `bun test` against a file list declared in a .txt manifest
 *   'command'    — runs an arbitrary command following the `--check` exit-code convention
 *                  (reserved for follow-up: SSOT drift, type-guard drift, critical guards, etc.)
 */

/** Gate that runs `bun test` against a file list declared in a manifest */
export type TestSuiteGate = {
  readonly kind: 'test-suite';
  /** Unique identifier used as the CLI argument: `bun scripts/run-gate.ts <id>` */
  readonly id: string;
  /** Human-readable description shown in runner output */
  readonly description: string;
  /** Path to the manifest .txt file, relative to the scripts/ directory */
  readonly manifest: string;
  /** Additional bun test flags appended before the file list (e.g. '--coverage', '--isolate') */
  readonly args?: readonly string[];
  /** Environment variables merged over process.env when spawning the test subprocess */
  readonly env?: Record<string, string>;
};

/**
 * Gate that runs an arbitrary command following the --check exit-code convention.
 * TODO: implement command-kind dispatch in run-gate.ts when a gate of this kind is first registered.
 */
export type CommandGate = {
  readonly kind: 'command';
  readonly id: string;
  readonly description: string;
  /** Executable path or command name */
  readonly command: string;
  /** Arguments passed to the command */
  readonly args?: readonly string[];
  /** Environment variables merged over process.env */
  readonly env?: Record<string, string>;
};

/** Discriminated union of all supported gate kinds */
export type GateEntry = TestSuiteGate | CommandGate;

/**
 * Central registry of all CI gate definitions for rapitas-backend.
 * Registering a gate here makes it runnable via `bun scripts/run-gate.ts <id>`.
 */
export const GATES: readonly GateEntry[] = [
  {
    kind: 'test-suite',
    id: 'backend-tests',
    description:
      'Backend CI gate — runs all test files listed in scripts/ci-gate-tests.txt with coverage',
    manifest: 'ci-gate-tests.txt',
    args: ['--coverage', '--isolate'],
  },
  {
    kind: 'test-suite',
    id: 'sqlite-tests',
    description:
      'SQLite compatibility gate — runs scripts/sqlite-compat-tests.txt with RAPITAS_DB_PROVIDER=sqlite',
    manifest: 'sqlite-compat-tests.txt',
    args: ['--isolate'],
    // NOTE: DATABASE_URL is forced (not a `?? fallback`) so the gate reliably tests
    // SQLite compatibility regardless of the ambient DATABASE_URL (e.g. a developer's
    // .env pointing at Postgres — the `??` previously left it Postgres-backed locally).
    // CI (test-lint.yml `test-sqlite` job) already sets DATABASE_URL="file:./rapitas-ci.db"
    // explicitly before invoking this gate; this mirrors that so local runs match CI.
    // RAPITAS_DB_PROVIDER forces the ORM to SQLite mode.
    env: {
      RAPITAS_DB_PROVIDER: 'sqlite',
      DATABASE_URL: 'file:./rapitas-ci.db',
    },
  },
];

/**
 * Retrieves a gate definition by its id.
 *
 * @param id - The gate id to look up / ゲート id
 * @returns The matching GateEntry, or `undefined` if the id is unknown
 */
export function getGate(id: string): GateEntry | undefined {
  return GATES.find((g) => g.id === id);
}
