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
      injectedSuccessRate: 0,
      controlSuccessRate: 0,
      injectedSampleCount: 0,
      controlSampleCount: 0,
    });
  });

  test('computes injected vs control success rates separately', () => {
    const result = aggregateEffectiveness([
      // injected group: 3 tasks, 2 succeeded
      sample({ injected: 4, success: true }) as never,
      sample({ injected: 2, success: true }) as never,
      sample({ injected: 1, success: false }) as never,
      // control group (injected: 0): 2 tasks, 1 succeeded
      sample({ injected: 0, success: true }) as never,
      sample({ injected: 0, success: false }) as never,
    ]);
    expect(result.injectedSampleCount).toBe(3);
    expect(result.controlSampleCount).toBe(2);
    expect(result.injectedSuccessRate).toBeCloseTo(2 / 3, 10);
    expect(result.controlSuccessRate).toBe(0.5);
    // Overall successRate spans both groups (3/5) for backward compatibility.
    expect(result.successRate).toBe(0.6);
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
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.data.sampledTasks).toBe(2);
    expect(result.data.successRate).toBe(0.5);
    expect(result.data.declarationRate).toBe(0.5);
  });

  test('malformed payload fields coerce to safe defaults', async () => {
    timelineEvents = [{ payload: { success: 'yes', injected: 'many', fineGrained: 1 } }];
    const result = await getKnowledgeEffectiveness();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.data.sampledTasks).toBe(1);
    expect(result.data.successRate).toBe(0); // 'yes' !== true
    expect(result.data.avgInjected).toBe(0);
  });

  test("query failure returns status:'unknown' instead of the zero aggregate", async () => {
    queryShouldFail = true;
    const result = await getKnowledgeEffectiveness();
    expect(result.status).toBe('unknown');
    if (result.status !== 'unknown') throw new Error('expected unknown');
    expect(result.reason).toContain('db down');
  });
});
