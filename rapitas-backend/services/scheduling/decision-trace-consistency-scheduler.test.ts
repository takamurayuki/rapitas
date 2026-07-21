/**
 * decision-trace-consistency-scheduler.test.ts
 *
 * Unit tests for DecisionTraceConsistencyScheduler lifecycle: immediate first
 * run, periodic re-runs on a short real interval (bun:test has no fake timers
 * for setInterval), idempotent start, and stop halting further runs.
 * The consistency-check barrel is stubbed via mock.module (process-global —
 * run this file in isolation; all barrel exports are mirrored).
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockRunBatch = mock(() => Promise.resolve({ checked: 0, updated: 0 })) as ReturnType<
  typeof mock
>;

// HACK(agent): bun の mock.module はプロセスグローバルなため、バレルの全エクスポートを
// ミラーしないと他 import が "export not found" をスローする。
mock.module('../observability/decision-trace', () => ({
  runConsistencyCheckBatch: mockRunBatch,
  recordDecision: () => Promise.resolve(),
  getDecisionDag: () => Promise.resolve({ nodes: [], edges: [] }),
  judgeConsistency: () => ({ consistency: 'skipped', note: '' }),
  maskSensitive: (v: unknown) => ({ masked: v, maskedFieldCount: 0 }),
  maskStringValue: (v: string) => ({ masked: v, count: 0 }),
}));

mock.module('../../config/logger', () => {
  const noopLogger = {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
    fatal: () => {},
  };
  return {
    createLogger: () => noopLogger,
    logger: noopLogger,
    getBackendLogFilePath: () => '/tmp/backend.log',
  };
});

const { DecisionTraceConsistencyScheduler } =
  await import('./decision-trace-consistency-scheduler');

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  mockRunBatch.mockReset();
  mockRunBatch.mockResolvedValue({ checked: 0, updated: 0 });
});

describe('DecisionTraceConsistencyScheduler', () => {
  it('runs immediately on start and again on each interval', async () => {
    const scheduler = new DecisionTraceConsistencyScheduler();
    try {
      scheduler.start(20);
      expect(scheduler.getIsRunning()).toBe(true);
      await sleep(5);
      expect(mockRunBatch.mock.calls.length).toBe(1); // immediate first run
      await sleep(50);
      expect(mockRunBatch.mock.calls.length).toBeGreaterThanOrEqual(2); // interval re-runs
    } finally {
      scheduler.stop();
    }
  });

  it('ignores a second start while running', async () => {
    const scheduler = new DecisionTraceConsistencyScheduler();
    try {
      scheduler.start(10_000);
      scheduler.start(10_000);
      await sleep(5);
      expect(mockRunBatch.mock.calls.length).toBe(1); // one immediate run, not two
    } finally {
      scheduler.stop();
    }
  });

  it('stops firing after stop()', async () => {
    const scheduler = new DecisionTraceConsistencyScheduler();
    scheduler.start(15);
    await sleep(5);
    scheduler.stop();
    expect(scheduler.getIsRunning()).toBe(false);
    const callsAtStop = mockRunBatch.mock.calls.length;
    await sleep(50);
    expect(mockRunBatch.mock.calls.length).toBe(callsAtStop);
  });

  it('keeps the interval alive when a batch rejects', async () => {
    mockRunBatch.mockRejectedValueOnce(new Error('boom'));
    const scheduler = new DecisionTraceConsistencyScheduler();
    try {
      scheduler.start(15);
      await sleep(50);
      expect(mockRunBatch.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      scheduler.stop();
    }
  });
});
