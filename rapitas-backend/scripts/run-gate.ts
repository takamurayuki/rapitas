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

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { type TestSuiteGate, GATES, getGate } from './ci-gates';
import { parseGateManifest, validateManifestFiles } from './gate-manifest-parser';

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
 * Executes a test-suite gate: loads manifest, validates file existence, then spawns bun test.
 *
 * @param gate - The test-suite gate to run / 実行するテストスイートゲート
 * @returns The bun test subprocess exit code (0 = all tests passed, non-0 = failure)
 */
async function runTestSuiteGate(gate: TestSuiteGate): Promise<number> {
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

  const args = buildTestSuiteArgs(gate, files);

  console.log(`[run-gate] ${gate.description}`);
  console.log(`[run-gate] Running ${files.length} test file(s)...`);

  const proc = Bun.spawn(['bun', ...args], {
    cwd: BACKEND_DIR,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: buildEnv(gate.env),
  });

  return await proc.exited;
}

/**
 * Resolves and runs a gate by id. Returns the subprocess exit code.
 * Calls process.exit() only for configuration errors (unknown id, etc.).
 * Exported so that adapter scripts (e.g. run-gate-tests.ts) can delegate without re-spawning bun.
 *
 * @param id - The gate id to run / 実行するゲート id
 * @returns Exit code from the gate subprocess (0 = success)
 */
export async function runGate(id: string | undefined): Promise<number> {
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
    return runTestSuiteGate(gate);
  }

  // NOTE: command-kind gates are not yet implemented — follow-up to wire in SSOT drift,
  // type-guard drift, critical-guard checks, etc. when first registered in ci-gates.ts.
  if (gate.kind === 'command') {
    console.error(`[run-gate] Command-kind gates are not yet implemented. Gate: ${gate.id}`);
    process.exit(1);
  }

  // NOTE: Exhaustiveness guard — unreachable with the current GateEntry union.
  const _exhaustive: never = gate;
  console.error(`[run-gate] Unhandled gate kind for gate id: ${id}`);
  return 1;
}

// NOTE: Guard prevents main() from running when this file is imported by unit tests.
if (import.meta.main) {
  const [, , gateId] = process.argv;
  const code = await runGate(gateId);
  process.exit(code);
}
