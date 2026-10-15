#!/usr/bin/env bun
/**
 * run-gate.ts
 *
 * Universal CI gate runner. Resolves a gate by id from the ci-gates.ts registry,
 * then dispatches to the appropriate execution strategy based on gate kind.
 *
 * Passes the subprocess exit code through unchanged so CI hard-gates fail correctly.
 * Validates manifest existence and file drift before spawning to prevent false-green results.
 *
 * Usage:
 *   bun scripts/run-gate.ts <gateId>
 *   bun run test:ci        # → backend-tests
 *   bun run test:sqlite    # → sqlite-tests
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { type TestSuiteGate, GATES, getGate } from './ci-gates';
import { enforceCoverageFloor } from './coverage-floor';
import { parseGateManifest, validateManifestFiles } from './gate-manifest-parser';
import { parseFilesArg } from './parse-files-arg';

const SCRIPTS_DIR = import.meta.dir;
const BACKEND_DIR = resolve(SCRIPTS_DIR, '..');

/**
 * Builds the bun test argv array for a test-suite gate.
 * Pure function exported for unit testing — does not spawn any process.
 *
 * @param gate - The test-suite gate entry / テストスイートゲート定義
 * @param files - Test file paths from the parsed manifest / マニフェストから取得したファイルリスト
 * @returns Full argv array to pass after 'bun' (e.g. ['test', '--coverage', '--isolate', ...files])
 */
export function buildTestSuiteArgs(gate: TestSuiteGate, files: string[]): string[] {
  return ['test', ...(gate.args ?? []), ...files];
}

/**
 * Loads the CI gate trigger map from `ci-gate-triggers.json`.
 * Returns `null` if the file is absent or cannot be parsed (callers fall back to full-run).
 *
 * @returns Map of test file path → trigger pattern list, or `null` on any load failure
 */
export function loadTriggers(): Record<string, string[]> | null {
  const triggersPath = resolve(SCRIPTS_DIR, 'ci-gate-triggers.json');
  if (!existsSync(triggersPath)) {
    console.warn('[run-gate] ci-gate-triggers.json not found — running all tests');
    return null;
  }
  try {
    const raw = readFileSync(triggersPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      console.warn('[run-gate] ci-gate-triggers.json is not a plain object — running all tests');
      return null;
    }
    return parsed as Record<string, string[]>;
  } catch {
    console.warn('[run-gate] Failed to parse ci-gate-triggers.json — running all tests');
    return null;
  }
}

/**
 * Returns true when a changed file path satisfies a trigger pattern.
 * Normalises backslashes to forward slashes before comparing.
 *
 * Matching rules (applied in order):
 *   1. Exact match:     `changedFile === trigger`
 *   2. Suffix match:    `changedFile.endsWith('/' + trigger)` (handles monorepo root-relative paths)
 *   3. Prefix match:    trigger ends with `/` and `changedFile.startsWith(trigger)` (directory triggers)
 *
 * @param changedFile - One changed file path from git diff / 変更ファイルパス
 * @param trigger - Trigger pattern: file path, path suffix, or directory prefix ending with `/`
 * @returns Whether the changed file satisfies the trigger
 */
export function matchesTrigger(changedFile: string, trigger: string): boolean {
  const f = changedFile.replace(/\\/g, '/');
  const t = trigger.replace(/\\/g, '/');
  if (f === t || f.endsWith('/' + t)) return true;
  // NOTE: Directory prefix trigger (e.g. "eslint-rules/") matches any file under that dir.
  if (t.endsWith('/') && f.startsWith(t)) return true;
  return false;
}

/**
 * Filters the full manifest test list to those triggered by the given changed files.
 *
 * Fallback rules (returns `allTests` unchanged):
 *   - `changedFiles` is `null`    → `--files` flag absent; caller did not provide change info
 *   - `changedFiles` is `[]`      → flag present but empty (e.g. initial push / shallow clone)
 *   - `triggers` is `null`        → trigger map unavailable; safe fallback to full run
 *
 * Registered test with no matching trigger → excluded (skipped).
 * Unregistered test (not in the trigger map) → always included (over-execution is safe).
 *
 * @param allTests - Full list of test file paths from the gate manifest
 * @param changedFiles - Changed file paths from git diff, or `null` when flag is absent
 * @param triggers - Trigger map from `ci-gate-triggers.json`, or `null` when unavailable
 * @returns Filtered list to run, or `allTests` for any full-run fallback case
 */
export function selectTests(
  allTests: string[],
  changedFiles: string[] | null,
  triggers: Record<string, string[]> | null,
): string[] {
  if (changedFiles === null || changedFiles.length === 0) return allTests;
  if (triggers === null) return allTests;

  return allTests.filter((test) => {
    const testTriggers = triggers[test];
    // Unregistered tests always run — over-execution is safe (drift won't cause silent skips).
    if (testTriggers === undefined) return true;
    return testTriggers.some((trigger) => changedFiles.some((cf) => matchesTrigger(cf, trigger)));
  });
}

/**
 * Builds the subprocess environment by merging gate-specific env overrides onto process.env.
 *
 * @param gateEnv - Gate-defined env overrides (applied on top of process.env)
 * @returns Merged env record safe to pass to Bun.spawn
 */
function buildEnv(gateEnv?: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) base[k] = v;
  }
  return { ...base, ...(gateEnv ?? {}) };
}

/**
 * Executes a test-suite gate: loads manifest, validates file existence, applies --files filtering,
 * then spawns bun test.
 *
 * When `changedFiles` is provided (non-null and non-empty), tests are filtered via
 * `selectTests()` using the trigger map from `ci-gate-triggers.json`. If the filter
 * produces an empty result the function logs a skip message and returns exit code 0
 * (legitimate skip, distinct from an empty manifest which returns exit code 1).
 *
 * @param gate - The test-suite gate to run / 実行するテストスイートゲート
 * @param changedFiles - Changed file paths from git diff, or `null` to run all tests
 * @returns The bun test subprocess exit code (0 = all tests passed / skip, non-0 = failure)
 */
async function runTestSuiteGate(
  gate: TestSuiteGate,
  changedFiles: string[] | null = null,
): Promise<number> {
  const manifestPath = resolve(SCRIPTS_DIR, gate.manifest);

  let manifestText: string;
  try {
    manifestText = readFileSync(manifestPath, 'utf-8');
  } catch {
    console.error(`[run-gate] Cannot read manifest: ${manifestPath}`);
    return 1;
  }

  const files = parseGateManifest(manifestText);

  if (files.length === 0) {
    // NOTE: Empty manifest is a configuration error — prevents silent "0 tests passed" green.
    console.error(
      `[run-gate] Manifest is empty or contains only comments: ${gate.manifest}. ` +
        'Add at least one test path.',
    );
    return 1;
  }

  // NOTE: Drift check generalises the validateFiles() guard from run-sqlite-tests.cjs:48-62
  // to all test-suite gates, including backend-tests which previously had no drift detection.
  const missing = validateManifestFiles(files, BACKEND_DIR);
  if (missing.length > 0) {
    console.error(
      `[run-gate] Drift detected — the following files in ${gate.manifest} do not exist on disk:`,
    );
    for (const f of missing) {
      console.error(`  - ${f}`);
    }
    console.error(`  Update ${gate.manifest} to reflect the current test file locations.`);
    return 1;
  }

  // Apply --files trigger filtering when changed files are known.
  const triggers = changedFiles !== null && changedFiles.length > 0 ? loadTriggers() : null;
  const filteredFiles = selectTests(files, changedFiles, triggers);

  // NOTE: Empty filter with known changed files = legitimate skip (no related tests).
  // This is distinct from an empty manifest (config error → exit 1).
  if (filteredFiles.length === 0) {
    console.log(
      `[run-gate] --files filter: no gate tests triggered by the changed files. Skipping.`,
    );
    return 0;
  }

  const skipped = files.length - filteredFiles.length;
  if (skipped > 0) {
    console.log(
      `[run-gate] --files filter: running ${filteredFiles.length}/${files.length} gate tests (${skipped} skipped).`,
    );
  }

  const args = buildTestSuiteArgs(gate, filteredFiles);

  console.log(`[run-gate] ${gate.description}`);
  console.log(`[run-gate] Running ${filteredFiles.length} test file(s)...`);

  const proc = Bun.spawn(['bun', ...args], {
    cwd: BACKEND_DIR,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: buildEnv(gate.env),
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) return exitCode;

  // Coverage floor applies only to FULL manifest runs — a --files-filtered
  // subset loads fewer modules, so its percentage cannot be compared to the
  // floor calibrated against the whole gate suite.
  if (gate.coverageFloor && filteredFiles.length === files.length) {
    return enforceCoverageFloor(gate, BACKEND_DIR);
  }
  return 0;
}

/**
 * Resolves and runs a gate by id. Returns the subprocess exit code.
 * Calls process.exit() only for configuration errors (unknown id, etc.).
 * Exported so that adapter scripts (e.g. run-gate-tests.ts) can delegate without re-spawning bun.
 *
 * When `changedFiles` is provided (non-null and non-empty), test-suite gates apply
 * `--files` trigger filtering via `selectTests()`. Pass `null` to run all tests (default).
 *
 * @param id - The gate id to run / 実行するゲート id
 * @param changedFiles - Changed file paths for trigger filtering, or `null` to run all tests
 * @returns Exit code from the gate subprocess (0 = success)
 */
export async function runGate(
  id: string | undefined,
  changedFiles: string[] | null = null,
): Promise<number> {
  if (!id) {
    console.error('[run-gate] Usage: bun scripts/run-gate.ts <gateId>');
    console.error(`[run-gate] Known gate ids: ${GATES.map((g) => g.id).join(', ')}`);
    process.exit(1);
  }

  const gate = getGate(id);
  if (!gate) {
    console.error(`[run-gate] Unknown gate id: "${id}"`);
    console.error(`[run-gate] Known gate ids: ${GATES.map((g) => g.id).join(', ')}`);
    process.exit(1);
  }

  if (gate.kind === 'test-suite') {
    return runTestSuiteGate(gate, changedFiles);
  }

  // NOTE: command-kind gates are not yet implemented — follow-up to wire in SSOT drift,
  // type-guard drift, critical-guard checks, etc. when first registered in ci-gates.ts.
  if (gate.kind === 'command') {
    console.error(`[run-gate] Command-kind gates are not yet implemented. Gate: ${gate.id}`);
    process.exit(1);
  }

  // NOTE: Exhaustiveness guard — unreachable with the current GateEntry union.
  // `satisfies never` keeps the compile-time check without an unused local.
  gate satisfies never;
  console.error(`[run-gate] Unhandled gate kind for gate id: ${id}`);
  return 1;
}

// NOTE: Guard prevents main() from running when this file is imported by unit tests.
if (import.meta.main) {
  const argv = process.argv;
  // NOTE: gateId is the first non-flag positional argument (e.g. 'backend-tests').
  const gateId = argv.slice(2).find((a) => !a.startsWith('-'));
  const changedFiles = parseFilesArg(argv);
  const code = await runGate(gateId, changedFiles);
  process.exit(code);
}
