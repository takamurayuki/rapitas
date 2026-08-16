/**
 * miss-approval-mode.test
 *
 * Boundary-value tests for the pure approval-mode derivation (acceptance
 * criteria 2/3/4): initial gate, data-floor refusal, exact-threshold rates,
 * and the auto→manual return path when rejections accumulate.
 */
import { describe, test, expect } from 'bun:test';
import {
  resolveApprovalMode,
  readMissApprovalConfig,
  type MissApprovalConfig,
} from './miss-approval-mode';

const CFG: MissApprovalConfig = {
  initialManualCount: 10,
  sampleFloor: 10,
  autoThreshold: 0.02,
  windowDays: 30,
};

describe('resolveApprovalMode — initial gate (acceptance 2)', () => {
  test('zero reviews → manual/initial_gate (every early suggestion needs a human)', () => {
    const d = resolveApprovalMode(
      { totalHumanReviews: 0, windowSamples: 0, windowRejections: 0 },
      CFG,
    );
    expect(d.mode).toBe('manual');
    expect(d.basis).toBe('initial_gate');
    expect(d.rejectionRate).toBeNull();
  });

  test('one below the initial count stays manual even with a clean window', () => {
    const d = resolveApprovalMode(
      { totalHumanReviews: 9, windowSamples: 9, windowRejections: 0 },
      CFG,
    );
    expect(d.mode).toBe('manual');
    expect(d.basis).toBe('initial_gate');
  });

  test('exactly the initial count passes the gate (>= boundary)', () => {
    const d = resolveApprovalMode(
      { totalHumanReviews: 10, windowSamples: 10, windowRejections: 0 },
      CFG,
    );
    expect(d.basis).not.toBe('initial_gate');
  });
});

describe('resolveApprovalMode — data floor (acceptance 4)', () => {
  test('window below the floor → insufficient_data, no rate, never auto', () => {
    const d = resolveApprovalMode(
      { totalHumanReviews: 25, windowSamples: 9, windowRejections: 0 },
      CFG,
    );
    expect(d.mode).toBe('manual');
    expect(d.basis).toBe('insufficient_data');
    expect(d.rejectionRate).toBeNull();
  });

  test('window exactly at the floor produces a judgement', () => {
    const d = resolveApprovalMode(
      { totalHumanReviews: 25, windowSamples: 10, windowRejections: 0 },
      CFG,
    );
    expect(d.basis).toBe('low_rejection');
    expect(d.rejectionRate).toBe(0);
  });
});

describe('resolveApprovalMode — rate thresholds (acceptance 3)', () => {
  test('rate exactly at the threshold still allows auto (<= boundary)', () => {
    // 1/50 = 0.02 — exactly the default threshold.
    const d = resolveApprovalMode(
      { totalHumanReviews: 50, windowSamples: 50, windowRejections: 1 },
      CFG,
    );
    expect(d.mode).toBe('auto');
    expect(d.basis).toBe('low_rejection');
    expect(d.rejectionRate).toBeCloseTo(0.02);
  });

  test('rate just above the threshold returns to manual/high_rejection', () => {
    // 2/50 = 0.04 > 0.02 — rejections accumulated after auto mode: back to manual.
    const d = resolveApprovalMode(
      { totalHumanReviews: 50, windowSamples: 50, windowRejections: 2 },
      CFG,
    );
    expect(d.mode).toBe('manual');
    expect(d.basis).toBe('high_rejection');
    expect(d.rejectionRate).toBeCloseTo(0.04);
  });

  test('clean window → auto/low_rejection', () => {
    const d = resolveApprovalMode(
      { totalHumanReviews: 40, windowSamples: 20, windowRejections: 0 },
      CFG,
    );
    expect(d.mode).toBe('auto');
    expect(d.rejectionRate).toBe(0);
  });
});

describe('readMissApprovalConfig', () => {
  test('falls back to plan defaults when env vars are unset or invalid', () => {
    const saved = {
      count: process.env.RAPITAS_MISS_INITIAL_MANUAL_COUNT,
      floor: process.env.RAPITAS_MISS_SAMPLE_FLOOR,
      threshold: process.env.RAPITAS_MISS_AUTO_THRESHOLD,
      window: process.env.RAPITAS_MISS_WINDOW_DAYS,
    };
    try {
      delete process.env.RAPITAS_MISS_INITIAL_MANUAL_COUNT;
      process.env.RAPITAS_MISS_SAMPLE_FLOOR = 'not-a-number';
      process.env.RAPITAS_MISS_AUTO_THRESHOLD = '5'; // out of [0,1] → fallback
      delete process.env.RAPITAS_MISS_WINDOW_DAYS;

      const cfg = readMissApprovalConfig();
      expect(cfg.initialManualCount).toBe(10);
      expect(cfg.sampleFloor).toBe(10);
      expect(cfg.autoThreshold).toBeCloseTo(0.02);
      expect(cfg.windowDays).toBe(30);
    } finally {
      if (saved.count !== undefined) process.env.RAPITAS_MISS_INITIAL_MANUAL_COUNT = saved.count;
      if (saved.floor === undefined) delete process.env.RAPITAS_MISS_SAMPLE_FLOOR;
      else process.env.RAPITAS_MISS_SAMPLE_FLOOR = saved.floor;
      if (saved.threshold === undefined) delete process.env.RAPITAS_MISS_AUTO_THRESHOLD;
      else process.env.RAPITAS_MISS_AUTO_THRESHOLD = saved.threshold;
      if (saved.window !== undefined) process.env.RAPITAS_MISS_WINDOW_DAYS = saved.window;
    }
  });

  test('reads valid env overrides', () => {
    const saved = process.env.RAPITAS_MISS_AUTO_THRESHOLD;
    try {
      process.env.RAPITAS_MISS_AUTO_THRESHOLD = '0.05';
      expect(readMissApprovalConfig().autoThreshold).toBeCloseTo(0.05);
    } finally {
      if (saved === undefined) delete process.env.RAPITAS_MISS_AUTO_THRESHOLD;
      else process.env.RAPITAS_MISS_AUTO_THRESHOLD = saved;
    }
  });
});
