/**
 * prompt-comparison-alpha-ledger.test
 *
 * Verifies the telescoping-series alpha budget math (alphaForCandidate /
 * alphaForLook), decideWithAlphaSpending's significance boundary, and the
 * k/j assignment + lock-release behaviour of recordAlphaSpendingDecision
 * against a temp RAPITAS_DATA_DIR (never the real home directory).
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  alphaForCandidate,
  alphaForLook,
  decideWithAlphaSpending,
  TOTAL_ALPHA,
} from './prompt-comparison-alpha-ledger';

describe('alphaForCandidate', () => {
  it('sums to at most TOTAL_ALPHA across 1000 candidates (telescoping series)', () => {
    let sum = 0;
    for (let k = 1; k <= 1000; k++) sum += alphaForCandidate(k);
    expect(sum).toBeLessThan(TOTAL_ALPHA + 1e-9);
  });

  it('throws for non-positive or non-integer k', () => {
    expect(() => alphaForCandidate(0)).toThrow(RangeError);
    expect(() => alphaForCandidate(-1)).toThrow(RangeError);
    expect(() => alphaForCandidate(1.5)).toThrow(RangeError);
  });
});

describe('alphaForLook', () => {
  it('sums to at most alphaK across 1000 looks (telescoping series)', () => {
    const alphaK = alphaForCandidate(1);
    let sum = 0;
    for (let j = 1; j <= 1000; j++) sum += alphaForLook(alphaK, j);
    expect(sum).toBeLessThan(alphaK + 1e-9);
  });

  it('throws for non-positive or non-integer j', () => {
    const alphaK = alphaForCandidate(1);
    expect(() => alphaForLook(alphaK, 0)).toThrow(RangeError);
    expect(() => alphaForLook(alphaK, -2)).toThrow(RangeError);
    expect(() => alphaForLook(alphaK, 2.5)).toThrow(RangeError);
  });
});

describe('decideWithAlphaSpending', () => {
  it('is significant when pValue is below the allotted alpha', () => {
    const alpha = alphaForLook(alphaForCandidate(1), 1);
    const decision = decideWithAlphaSpending(1, 1, alpha / 2);
    expect(decision.significant).toBe(true);
    expect(decision.alpha).toBeCloseTo(alpha, 12);
  });

  it('is not significant when pValue equals or exceeds the allotted alpha', () => {
    const alpha = alphaForLook(alphaForCandidate(1), 1);
    expect(decideWithAlphaSpending(1, 1, alpha).significant).toBe(false);
    expect(decideWithAlphaSpending(1, 1, alpha * 2).significant).toBe(false);
  });
});

describe('recordAlphaSpendingDecision', () => {
  let dataDir: string;
  let originalDataDir: string | undefined;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'rapitas-alpha-ledger-test-'));
    originalDataDir = process.env.RAPITAS_DATA_DIR;
    process.env.RAPITAS_DATA_DIR = dataDir;
  });

  afterEach(() => {
    if (originalDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
    else process.env.RAPITAS_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('assigns k=1 to the first new candidate and k=2 to the second', async () => {
    const { recordAlphaSpendingDecision } = await import('./prompt-comparison-alpha-storage');
    const first = recordAlphaSpendingDecision(101, 0.5);
    const second = recordAlphaSpendingDecision(102, 0.5);
    expect(first.k).toBe(1);
    expect(second.k).toBe(2);
  });

  it('increments j on repeated calls for the same candidate', async () => {
    const { recordAlphaSpendingDecision } = await import('./prompt-comparison-alpha-storage');
    const firstLook = recordAlphaSpendingDecision(201, 0.5);
    const secondLook = recordAlphaSpendingDecision(201, 0.5);
    expect(firstLook.j).toBe(1);
    expect(secondLook.j).toBe(2);
    expect(firstLook.k).toBe(secondLook.k);
  });

  it('releases the lock file after each call', async () => {
    const { recordAlphaSpendingDecision } = await import('./prompt-comparison-alpha-storage');
    recordAlphaSpendingDecision(301, 0.5);
    expect(existsSync(join(dataDir, '.prompt-comparisons', '_alpha-ledger.json.lock'))).toBe(false);
  });
});
