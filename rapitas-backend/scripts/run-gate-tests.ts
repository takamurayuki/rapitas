#!/usr/bin/env bun
/**
 * run-gate-tests.ts
 *
 * Reads the CI gate suite manifest (scripts/ci-gate-tests.txt) and runs
 * `bun test --coverage --isolate <files>` as a subprocess. Exit code is
 * propagated from the subprocess so CI hard-gates correctly on failure.
 *
 * Exits non-zero immediately when the manifest resolves to an empty file
 * list to prevent "0 tests, all green" false passes.
 *
 * Usage:
 *   bun scripts/run-gate-tests.ts
 *   bun run test:ci
 */

import { resolve } from 'path';
import { readFileSync } from 'fs';

/**
 * Parses a gate-suite manifest text into a list of test file paths.
 * Lines starting with '#' (after trim) and blank lines are ignored.
 * Each returned entry is trimmed.
 *
 * @param text - Raw manifest file content / マニフェストファイルの生テキスト
 * @returns Array of trimmed, non-empty, non-comment file path strings
 */
export function parseGateManifest(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

async function main(): Promise<void> {
  const root = resolve(import.meta.dir, '..');
  const manifestPath = resolve(import.meta.dir, 'ci-gate-tests.txt');

  let manifestText: string;
  try {
    manifestText = readFileSync(manifestPath, 'utf-8');
  } catch (err) {
    console.error(`[run-gate-tests] Cannot read manifest: ${manifestPath}`);
    console.error(err);
    process.exit(1);
  }

  const files = parseGateManifest(manifestText);

  if (files.length === 0) {
    // NOTE: Empty manifest is a configuration error — prevents silent "0 tests passed" green.
    console.error(
      '[run-gate-tests] Manifest is empty or all lines are comments. ' +
        'Add at least one test path to scripts/ci-gate-tests.txt.',
    );
    process.exit(1);
  }

  console.log(`[run-gate-tests] Running ${files.length} gate suite files with coverage...`);

  const proc = Bun.spawn(['bun', 'test', '--coverage', '--isolate', ...files], {
    cwd: root,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env },
  });

  const exitCode = await proc.exited;
  process.exit(exitCode);
}

// NOTE: Guard prevents main() from running when this file is imported by unit tests.
if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error('[run-gate-tests] Fatal error:', err);
    process.exit(1);
  });
}
