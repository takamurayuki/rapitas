/**
 * prompt-comparison-alpha-spending.simulation.test
 *
 * Monte Carlo validation (acceptance criterion 2) that combining the Fisher
 * exact test with the alpha-spending ledger keeps the family-wise Type I
 * error rate at or below TOTAL_ALPHA under repeated re-evaluation, and that
 * the schedule is not so conservative it fails to detect a real effect.
 * Uses a fixed-seed PRNG (no Math.random()) so the test is deterministic and
 * flake-free across runs.
 */
import { describe, it, expect } from 'bun:test';
import { fisherExactOneSidedGreater } from './prompt-comparison-metrics';
import { decideWithAlphaSpending, TOTAL_ALPHA } from './prompt-comparison-alpha-ledger';

const NUM_FAMILIES = 200;
const CANDIDATES_PER_FAMILY = 10;
const MAX_LOOKS_PER_CANDIDATE = 5;
const SAMPLES_PER_ARM = 10;
const SEED = 0x9e3779b9;

/** Deterministic PRNG (mulberry32) so the simulation never flakes. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sample a binomial success count out of n trials at probability p. */
function sampleBinomial(rand: () => number, n: number, p: number): number {
  let successes = 0;
  for (let i = 0; i < n; i++) if (rand() < p) successes++;
  return successes;
}

/**
 * Run one family (a sequence of candidates, each re-evaluated up to
 * maxLooks times) and report whether any look was flagged significant.
 *
 * @returns True if the family produced at least one significant look, and
 *   the number of looks consumed by the first significant candidate (or
 *   maxLooks if none were significant). / 家族内で1件でも有意判定が出たか
 */
function runFamily(
  rand: () => number,
  currentP: number,
  candidateP: number,
  maxLooks: number,
): { anySignificant: boolean; firstSignificantAtLook: number | null } {
  let anySignificant = false;
  let firstSignificantAtLook: number | null = null;
  for (let k = 1; k <= CANDIDATES_PER_FAMILY; k++) {
    for (let j = 1; j <= maxLooks; j++) {
      const currentSuccess = sampleBinomial(rand, SAMPLES_PER_ARM, currentP);
      const candidateSuccess = sampleBinomial(rand, SAMPLES_PER_ARM, candidateP);
      const pValue = fisherExactOneSidedGreater(
        candidateSuccess,
        SAMPLES_PER_ARM - candidateSuccess,
        currentSuccess,
        SAMPLES_PER_ARM - currentSuccess,
      );
      const decision = decideWithAlphaSpending(k, j, pValue);
      if (decision.significant) {
        anySignificant = true;
        if (firstSignificantAtLook === null) firstSignificantAtLook = j;
        break;
      }
    }
  }
  return { anySignificant, firstSignificantAtLook };
}

describe('alpha-spending Monte Carlo simulation', () => {
  it('keeps the family-wise false-positive rate at or below TOTAL_ALPHA under the null', () => {
    const rand = mulberry32(SEED);
    let falsePositiveFamilies = 0;
    for (let f = 0; f < NUM_FAMILIES; f++) {
      const { anySignificant } = runFamily(rand, 0.5, 0.5, MAX_LOOKS_PER_CANDIDATE);
      if (anySignificant) falsePositiveFamilies++;
    }
    const familyFalsePositiveRate = falsePositiveFamilies / NUM_FAMILIES;
    // Each family independently replicates the alpha-spending schedule from
    // k=1, so its own false-discovery probability is bounded by TOTAL_ALPHA.
    // Margin of 0.05 accounts for Monte Carlo sampling noise at N=200 families.
    expect(familyFalsePositiveRate).toBeLessThanOrEqual(TOTAL_ALPHA + 0.05);
  });

  it('detects a real effect within 5 looks for most families (power check)', () => {
    const rand = mulberry32(SEED + 1);
    let detectedFamilies = 0;
    for (let f = 0; f < NUM_FAMILIES; f++) {
      const { anySignificant } = runFamily(rand, 0.3, 0.8, MAX_LOOKS_PER_CANDIDATE);
      if (anySignificant) detectedFamilies++;
    }
    const powerRate = detectedFamilies / NUM_FAMILIES;
    expect(powerRate).toBeGreaterThan(0.7);
  });
});
