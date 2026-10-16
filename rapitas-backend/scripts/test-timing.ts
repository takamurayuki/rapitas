#!/usr/bin/env bun
/**
 * test-timing.ts
 *
 * CLI that runs all backend test files in parallel and writes timing results
 * to the cache file for the CI timing dashboard (GET /ci-timing).
 *
 * Usage:
 *   bun run test:timing
 *   RAPITAS_TEST_CONCURRENCY=4 bun run test:timing
 *
 * Output:
 *   Writes .rapitas-test-timing.json to RAPITAS_DATA_DIR (or backend root as fallback).
 */

import { cpus } from 'os';
import { relative, resolve } from 'path';
import { writeFileSync } from 'fs';
import { collectTestFiles } from './shuffle-test';
import { runFile, resolveConcurrency } from './parallel-test';
import { getTimingCachePath } from '../services/analytics/ci-timing';
import type { TimingEntry, TimingCacheRaw } from '../services/analytics/ci-timing';

async function main(): Promise<void> {
  const root = resolve(import.meta.dir, '..');
  const concurrency = resolveConcurrency(process.env.RAPITAS_TEST_CONCURRENCY, cpus().length);

  const files = await collectTestFiles(root);

  if (files.length === 0) {
    console.warn('[test-timing] No test files found — exiting.');
    process.exit(0);
  }

  console.log(`[test-timing] files=${files.length} concurrency=${concurrency}`);
  const wallStart = performance.now();

  const results: TimingEntry[] = [];
  let completed = 0;
  const queue = [...files];

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const file = queue.shift();
      if (!file) break;
      const result = await runFile(file, root);
      completed++;
      const relFile = relative(root, file);
      const passed = result.exitCode === 0;
      console.log(
        `[${completed}/${files.length}] ${passed ? 'PASS' : 'FAIL'} ${relFile} (${result.elapsedMs.toFixed(0)}ms)`,
      );
      results.push({ file: relFile, elapsedMs: result.elapsedMs, exitCode: result.exitCode });
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, files.length) }, () => worker());
  await Promise.all(workers);

  const wallClockMs = performance.now() - wallStart;
  const passedCount = results.filter((r) => r.exitCode === 0).length;
  const failedCount = results.length - passedCount;

  console.log(
    `\n[test-timing] Done: ${passedCount} passed, ${failedCount} failed in ${(wallClockMs / 1000).toFixed(1)}s`,
  );

  const cache: TimingCacheRaw = {
    generatedAt: new Date().toISOString(),
    wallClockMs,
    results,
  };

  const cachePath = getTimingCachePath();
  writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
  console.log(`[test-timing] Cache written to: ${cachePath}`);
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error('[test-timing] Fatal:', err);
    process.exit(1);
  });
}
