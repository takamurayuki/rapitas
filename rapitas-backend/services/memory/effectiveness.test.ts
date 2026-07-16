/**
 * effectiveness.test
 *
 * Verifies aggregateEffectiveness (pure math) and the timeline-backed
 * getKnowledgeEffectiveness loader's payload parsing and failure fallback.
 * Own file — mock.module is process-global.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({ createLogger: () => noopLogger }));

let timelineEvents: Array<{ payload: Record<string, unknown> }> = [];
let queryShouldFail = false;
mock.module('./timeline', () => ({
  queryEvents: mock(() => {
    if (queryShouldFail) return Promise.reject(new Error('db down'));
    return Promise.resolve({ events: timelineEvents, total: timelineEvents.length });
  }),
}));

const { aggregateEffectiveness, getKnowledgeEffectiveness } = await import('./effectiveness');

beforeEach(() => {
  timelineEvents = [];
  queryShouldFail = false;
});

function sample(over: Partial<Record<string, unknown>> = {}) {
  return {
    success: true,
    injected: 4,
    applied: 4,
    fineGrained: false,
    used: null,
    wrong: null,
    ...over,
  };
}

describe('aggregateEffectiveness', () => {
  test('returns zeroes for no samples', () => {
    expect(aggregateEffectiveness([])).toEqual({
      sampledTasks: 0,
      successRate: 0,
      declarationRate: 0,
      usageRate: 0,
      wrongFlagged: 0,
      avgInjected: 0,
    });
  });

  test('computes success/declaration/usage rates', () => {
    const result = aggregateEffectiveness([
      // declared, used 2 of 4, succeeded
      sample({ fineGrained: true, used: 2, wrong: 1 }) as never,
      // undeclared failure
      sample({ success: false }) as never,
    ]);
    expect(result.sampledTasks).toBe(2);
    expect(result.successRate).toBe(0.5);
    expect(result.declarationRate).toBe(0.5);
    expect(result.usageRate).toBe(0.5); // 2/4 on the single declared sample
    expect(result.wrongFlagged).toBe(1);
    expect(result.avgInjected).toBe(4);
  });

  test('caps usage rate at 1 even if declaration exceeds injections', () => {
    const result = aggregateEffectiveness([
      sample({ fineGrained: true, used: 9, injected: 3 }) as never,
    ]);
    expect(result.usageRate).toBe(1);
  });
});

describe('getKnowledgeEffectiveness', () => {
  test('parses timeline payloads and aggregates', async () => {
    timelineEvents = [
      { payload: { success: true, injected: 5, applied: 5, fineGrained: true, used: 3, wrong: 0 } },
      { payload: { success: false, injected: 2, applied: 2, fineGrained: false } },
    ];
    const result = await getKnowledgeEffectiveness();
    expect(result.sampledTasks).toBe(2);
    expect(result.successRate).toBe(0.5);
    expect(result.declarationRate).toBe(0.5);
  });

  test('malformed payload fields coerce to safe defaults', async () => {
    timelineEvents = [{ payload: { success: 'yes', injected: 'many', fineGrained: 1 } }];
    const result = await getKnowledgeEffectiveness();
    expect(result.sampledTasks).toBe(1);
    expect(result.successRate).toBe(0); // 'yes' !== true
    expect(result.avgInjected).toBe(0);
  });

  test('query failure returns the zero aggregate instead of throwing', async () => {
    queryShouldFail = true;
    const result = await getKnowledgeEffectiveness();
    expect(result.sampledTasks).toBe(0);
  });
});
