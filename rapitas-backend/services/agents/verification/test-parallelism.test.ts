/**
 * test-parallelism.test
 *
 * Task 1553 acceptance 4: on hosts with 4 or fewer logical cores the
 * verification gate's test commands run with a parallelism of 2.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  LOW_CORE_THRESHOLD,
  LOW_CORE_TEST_WORKERS,
  resolveVerifyTestWorkers,
} from './test-parallelism';
import { buildFileScopedCommand } from './related-tests';

describe('resolveVerifyTestWorkers', () => {
  test('constants: 4 cores or fewer → 2 workers', () => {
    expect(LOW_CORE_THRESHOLD).toBe(4);
    expect(LOW_CORE_TEST_WORKERS).toBe(2);
  });

  test('1 and 4 cores → 2; 5 and 8 cores → null (runner default)', () => {
    expect(resolveVerifyTestWorkers(1)).toBe(2);
    expect(resolveVerifyTestWorkers(4)).toBe(2);
    expect(resolveVerifyTestWorkers(5)).toBeNull();
    expect(resolveVerifyTestWorkers(8)).toBeNull();
  });

  test('a non-positive or non-finite core count is treated as a small host', () => {
    expect(resolveVerifyTestWorkers(0)).toBe(2);
    expect(resolveVerifyTestWorkers(Number.NaN)).toBe(2);
  });

  test('defaults to the real host core count', () => {
    const v = resolveVerifyTestWorkers();
    expect(v === null || v === 2).toBe(true);
  });
});

describe('buildFileScopedCommand parallelism', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'test-par-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('vitest on 4 cores gets --maxWorkers=2; on 8 cores nothing', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }));
    writeFileSync(join(root, 'pnpm-lock.yaml'), '');
    expect(buildFileScopedCommand(root, ['a.test.ts'], 4)).toBe(
      'pnpm exec vitest run --maxWorkers=2 "a.test.ts"',
    );
    expect(buildFileScopedCommand(root, ['a.test.ts'], 8)).toBe('pnpm exec vitest run "a.test.ts"');
  });

  test('bun on 4 cores gets --max-concurrency=2; on 8 cores nothing', () => {
    expect(buildFileScopedCommand(root, ['a.test.ts'], 4)).toBe(
      'bun test --isolate --max-concurrency=2 "a.test.ts"',
    );
    expect(buildFileScopedCommand(root, ['a.test.ts'], 8)).toBe('bun test --isolate "a.test.ts"');
  });
});
