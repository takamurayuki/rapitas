/**
 * merge-barrier.test.ts
 *
 * Unit tests for the mergeBarrierEnabled file-backed toggle and the pure
 * shouldHoldForBarrier decision (task 573, requirement C).
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  MERGE_BARRIER_DEFAULT_MAX_HOLD_MS,
  getMergeBarrierMaxHoldMs,
  readMergeBarrierEnabled,
  writeMergeBarrierEnabled,
  shouldHoldForBarrier,
} from './merge-barrier';

describe('read/writeMergeBarrierEnabled (file-backed toggle)', () => {
  let dir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'merge-barrier-test-'));
    prevDataDir = process.env.RAPITAS_DATA_DIR;
    process.env.RAPITAS_DATA_DIR = dir;
  });

  afterEach(() => {
    if (prevDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
    else process.env.RAPITAS_DATA_DIR = prevDataDir;
    rmSync(dir, { recursive: true, force: true });
  });

  it('defaults to false when the file is absent (既定OFF)', () => {
    expect(readMergeBarrierEnabled()).toBe(false);
  });

  it('round-trips true → true, false → false', () => {
    writeMergeBarrierEnabled(true);
    expect(readMergeBarrierEnabled()).toBe(true);
    writeMergeBarrierEnabled(false);
    expect(readMergeBarrierEnabled()).toBe(false);
  });
});

describe('getMergeBarrierMaxHoldMs', () => {
  let prev: string | undefined;

  beforeEach(() => {
    prev = process.env.MERGE_BARRIER_MAX_HOLD_MS;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.MERGE_BARRIER_MAX_HOLD_MS;
    else process.env.MERGE_BARRIER_MAX_HOLD_MS = prev;
  });

  it('defaults to 30 minutes when env is unset', () => {
    delete process.env.MERGE_BARRIER_MAX_HOLD_MS;
    expect(getMergeBarrierMaxHoldMs()).toBe(MERGE_BARRIER_DEFAULT_MAX_HOLD_MS);
    expect(MERGE_BARRIER_DEFAULT_MAX_HOLD_MS).toBe(30 * 60 * 1000);
  });

  it('honours a positive env override and rejects invalid values', () => {
    process.env.MERGE_BARRIER_MAX_HOLD_MS = '60000';
    expect(getMergeBarrierMaxHoldMs()).toBe(60000);
    process.env.MERGE_BARRIER_MAX_HOLD_MS = 'not-a-number';
    expect(getMergeBarrierMaxHoldMs()).toBe(MERGE_BARRIER_DEFAULT_MAX_HOLD_MS);
    process.env.MERGE_BARRIER_MAX_HOLD_MS = '-5';
    expect(getMergeBarrierMaxHoldMs()).toBe(MERGE_BARRIER_DEFAULT_MAX_HOLD_MS);
  });
});

describe('shouldHoldForBarrier (pure decision)', () => {
  const MAX = 30 * 60 * 1000;
  const NOW = 1_000_000_000;

  it('OFF → never holds, even with an open PR', () => {
    expect(shouldHoldForBarrier(false, true, NOW, NOW, MAX)).toBe(false);
    expect(shouldHoldForBarrier(false, false, null, NOW, MAX)).toBe(false);
  });

  it('ON + open auto-PR → holds (hold just starting: holdSince null)', () => {
    expect(shouldHoldForBarrier(true, true, null, NOW, MAX)).toBe(true);
  });

  it('ON + open auto-PR + within the ceiling → keeps holding', () => {
    expect(shouldHoldForBarrier(true, true, NOW - MAX + 1, NOW, MAX)).toBe(true);
  });

  it('ON + open PR disappeared (merged/closed) → releases', () => {
    expect(shouldHoldForBarrier(true, false, NOW - 1000, NOW, MAX)).toBe(false);
  });

  it('ON + hold exceeded the ceiling → timeout release (deadlock guard)', () => {
    expect(shouldHoldForBarrier(true, true, NOW - MAX, NOW, MAX)).toBe(false);
    expect(shouldHoldForBarrier(true, true, NOW - MAX - 1, NOW, MAX)).toBe(false);
  });
});
