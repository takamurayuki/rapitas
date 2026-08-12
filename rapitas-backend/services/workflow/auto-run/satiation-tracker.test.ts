/**
 * satiation-tracker.test
 *
 * Covers the file-backed dry-cycle counter: increment, the 2-cycle satiation
 * edge (justSatiated exactly once), reset, per-theme independence, persistence
 * across "restarts" (state is file-backed, not in-memory), and corrupt-file
 * recovery (受入基準2の状態保持部分).
 */
import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  recordDryCycle,
  resetSatiation,
  isSatiated,
  SATIATION_DRY_CYCLE_THRESHOLD,
} from './satiation-tracker';

const tempRoot = mkdtempSync(join(tmpdir(), 'satiation-tracker-test-'));
const originalDataDir = process.env.RAPITAS_DATA_DIR;
let caseId = 0;

beforeEach(() => {
  // A fresh data dir per test isolates the file-backed state without deletes.
  caseId += 1;
  process.env.RAPITAS_DATA_DIR = join(tempRoot, `case-${caseId}`);
});

afterAll(() => {
  if (originalDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
  else process.env.RAPITAS_DATA_DIR = originalDataDir;
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('recordDryCycle', () => {
  test('the first dry cycle does not satiate', () => {
    const r = recordDryCycle(1);
    expect(r.dryCycles).toBe(1);
    expect(r.justSatiated).toBe(false);
    expect(isSatiated(1)).toBe(false);
  });

  test('the second consecutive dry cycle crosses into satiated exactly once', () => {
    recordDryCycle(1);
    const second = recordDryCycle(1);
    expect(second.dryCycles).toBe(SATIATION_DRY_CYCLE_THRESHOLD);
    expect(second.justSatiated).toBe(true);
    expect(isSatiated(1)).toBe(true);

    // A third dry cycle stays satiated but must NOT re-fire the edge.
    const third = recordDryCycle(1);
    expect(third.dryCycles).toBe(3);
    expect(third.justSatiated).toBe(false);
  });

  test('themes are tracked independently', () => {
    recordDryCycle(1);
    recordDryCycle(1);
    expect(isSatiated(1)).toBe(true);
    expect(isSatiated(2)).toBe(false);
    expect(recordDryCycle(2).dryCycles).toBe(1);
  });

  test('the count is file-backed: it survives a restart (no in-memory state)', () => {
    // Both calls read/write RAPITAS_DATA_DIR/.satiation-state.json — there is no
    // module-level cache, so a dev restart (exit75) between them changes nothing.
    recordDryCycle(7);
    expect(existsSync(join(process.env.RAPITAS_DATA_DIR ?? '', '.satiation-state.json'))).toBe(
      true,
    );
    const afterRestart = recordDryCycle(7);
    expect(afterRestart.dryCycles).toBe(2);
    expect(afterRestart.justSatiated).toBe(true);
  });
});

describe('resetSatiation', () => {
  test('reset returns the theme to zero and clears satiated', () => {
    recordDryCycle(1);
    recordDryCycle(1);
    resetSatiation(1);
    expect(isSatiated(1)).toBe(false);
    const next = recordDryCycle(1);
    expect(next.dryCycles).toBe(1);
    expect(next.justSatiated).toBe(false);
  });

  test('after a reset, two more consecutive dry cycles re-fire justSatiated', () => {
    recordDryCycle(1);
    recordDryCycle(1);
    resetSatiation(1);
    recordDryCycle(1);
    expect(recordDryCycle(1).justSatiated).toBe(true);
  });

  test('resetting an untracked theme is a no-op', () => {
    resetSatiation(99);
    expect(isSatiated(99)).toBe(false);
  });
});

describe('corrupt or invalid state file', () => {
  test('a corrupt JSON file falls back to the empty default', () => {
    const dir = process.env.RAPITAS_DATA_DIR ?? '';
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.satiation-state.json'), '{not json');
    expect(isSatiated(1)).toBe(false);
    expect(recordDryCycle(1).dryCycles).toBe(1);
  });

  test('malformed entries are dropped, valid ones kept', () => {
    const dir = process.env.RAPITAS_DATA_DIR ?? '';
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, '.satiation-state.json'),
      JSON.stringify({ '1': { dryCycles: 'oops' }, '2': { dryCycles: 2, satiated: true } }),
    );
    expect(isSatiated(1)).toBe(false);
    expect(isSatiated(2)).toBe(true);
  });
});
