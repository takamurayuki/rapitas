#!/usr/bin/env bun
/**
 * shuffle-test.ts
 *
 * Collects backend unit test files, shuffles them using a seeded PRNG,
 * and runs `bun test <files...>` to surface test order dependencies.
 * Excludes integration tests (which require a live database connection).
 *
 * Environment variables:
 *   TEST_SHUFFLE_SEED  Optional integer seed. Defaults to DEFAULT_SEED.
 *                      Supply the logged seed on failure to reproduce the same order.
 *
 * Usage:
 *   bun scripts/shuffle-test.ts
 *   TEST_SHUFFLE_SEED=42 bun scripts/shuffle-test.ts
 */

import { Glob } from 'bun';
import { resolve } from 'path';

/** Fixed fallback seed used when TEST_SHUFFLE_SEED is not set. */
const DEFAULT_SEED = 20250101;

/** Matches paths that belong to integration tests (DB-dependent, excluded from shuffle). */
export const INTEGRATION_EXCLUDE_PATTERN = /[/\\]tests[/\\]integration[/\\]/;

/**
 * Creates a Linear Congruential Generator (LCG) seeded PRNG.
 * Parameters from Numerical Recipes: a=1664525, c=1013904223, m=2^32.
 *
 * @param seed - Integer seed value / 初期シード値
 * @returns Function returning uniformly distributed floats in [0, 1)
 */
export function createLcgPrng(seed: number): () => number {
  // Coerce to unsigned 32-bit integer to keep state in range.
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * Shuffles a copy of the array using the Fisher-Yates algorithm with the provided PRNG.
 *
 * @param arr - Source array to shuffle / シャッフル元配列（変更しない）
 * @param prng - Seeded PRNG returning floats in [0, 1) / シード付き乱数生成関数
 * @returns New shuffled array; the original is not mutated
 */
export function shuffleArray<T>(arr: readonly T[], prng: () => number): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}

/**
 * Removes entries whose path matches the given exclusion pattern.
 *
 * @param files - File path list to filter / フィルタ対象のファイルパスリスト
 * @param excludePattern - Regex for paths to remove / 除外するパスのパターン
 * @returns Filtered list with matching paths removed
 */
export function filterExcluded(files: string[], excludePattern: RegExp): string[] {
  return files.filter((f) => !excludePattern.test(f));
}

/**
 * Parses a seed integer from a raw string, falling back to DEFAULT_SEED on invalid input.
 *
 * @param raw - Raw string from environment variable, or undefined / 環境変数の生の文字列
 * @returns Parsed integer seed value
 */
export function parseSeed(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_SEED;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_SEED;
}

/**
 * Globs all `*.test.ts` files under the backend root, excluding node_modules
 * and paths matching INTEGRATION_EXCLUDE_PATTERN.
 *
 * @param root - Absolute path to the backend root directory / バックエンドルートの絶対パス
 * @returns Sorted list of absolute file paths ready for shuffling
 */
export async function collectTestFiles(root: string): Promise<string[]> {
  const glob = new Glob('**/*.test.ts');
  const files: string[] = [];
  for await (const file of glob.scan({ cwd: root, absolute: true })) {
    if (!file.includes('node_modules')) {
      files.push(file);
    }
  }
  // Sort before shuffling so the baseline is always deterministic.
  files.sort();
  return filterExcluded(files, INTEGRATION_EXCLUDE_PATTERN);
}

async function main(): Promise<void> {
  const root = resolve(import.meta.dir, '..');
  const seed = parseSeed(process.env.TEST_SHUFFLE_SEED);

  const files = await collectTestFiles(root);

  if (files.length === 0) {
    console.warn('[shuffle-test] No test files found — exiting with success.');
    process.exit(0);
  }

  const prng = createLcgPrng(seed);
  const shuffled = shuffleArray(files, prng);

  console.log(`[shuffle-test] seed=${seed} files=${shuffled.length}`);
  console.log('[shuffle-test] First 5 files in shuffled order:');
  shuffled.slice(0, 5).forEach((f) => console.log(`  ${f}`));
  console.log('[shuffle-test] (Pass TEST_SHUFFLE_SEED=' + seed + ' to reproduce this order)\n');
  console.log('[shuffle-test] Running bun test in shuffled order...\n');

  const proc = Bun.spawn(['bun', 'test', '--isolate', ...shuffled], {
    cwd: root,
    stdio: ['inherit', 'inherit', 'inherit'],
    env: { ...process.env },
  });

  const exitCode = await proc.exited;
  process.exit(exitCode);
}

// NOTE: Guard prevents main() from running when this file is imported by unit tests.
if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error('[shuffle-test] Fatal error:', err);
    process.exit(1);
  });
}
