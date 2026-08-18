/**
 * Tests for workflow-context-metrics.
 *
 * Covers the token-estimation formula (ja/en/mixed), empty-section exclusion,
 * total aggregation, and the fail-soft guarantee of recordContextMetrics
 * (never rejects even when appendEvent fails).
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';

const appendEvent = mock((_event: unknown) => Promise.resolve({ id: 1 }));
mock.module('../memory/timeline', () => ({
  appendEvent,
  queryEvents: mock(() => Promise.resolve({ events: [], total: 0, limit: 50, offset: 0 })),
}));

const logInfo = mock((_payload: unknown, _msg?: string) => {});
const logDebug = mock((_payload: unknown, _msg?: string) => {});
// Full export mirror — bun's mock.module is process-global; a partial mock
// breaks transitive importers of the unmocked exports.
mock.module('../../config/logger', () => ({
  createLogger: mock(() => ({
    info: logInfo,
    debug: logDebug,
    warn: mock(() => {}),
    error: mock(() => {}),
  })),
  logger: { info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) },
  getBackendLogFilePath: mock(() => ''),
}));

const { estimateTokens, computeSectionMetrics, recordContextMetrics } =
  await import('./workflow-context-metrics');

beforeEach(() => {
  appendEvent.mockClear();
  appendEvent.mockImplementation(() => Promise.resolve({ id: 1 }));
  logInfo.mockClear();
  logDebug.mockClear();
});

describe('estimateTokens', () => {
  test('pure Japanese counts ~1 token per character', () => {
    // 10 CJK chars → 10 tokens
    expect(estimateTokens('コンテキスト計測を行う')).toBe(11);
    expect(estimateTokens('あいうえお')).toBe(5);
  });

  test('pure English counts ~4 chars per token', () => {
    // 8 ASCII chars / 4 = 2 tokens
    expect(estimateTokens('abcdefgh')).toBe(2);
    // 100 chars / 4 = 25
    expect(estimateTokens('a'.repeat(100))).toBe(25);
  });

  test('mixed text apportions by character class', () => {
    // 5 CJK (5 tokens) + 8 ASCII (2 tokens) = 7
    expect(estimateTokens('あいうえお' + 'abcdefgh')).toBe(7);
  });

  test('empty string estimates 0', () => {
    expect(estimateTokens('')).toBe(0);
  });
});

describe('computeSectionMetrics', () => {
  test('excludes empty, null and undefined sections', () => {
    const metrics = computeSectionMetrics({
      taskInfo: 'abcd',
      emptyOne: '',
      nullOne: null,
      undefinedOne: undefined,
    });
    expect(metrics.sections.map((s) => s.name)).toEqual(['taskInfo']);
  });

  test('per-section chars and totals are consistent', () => {
    const metrics = computeSectionMetrics({ a: 'abcd', b: 'あいうえお' });
    expect(metrics.sections).toEqual([
      { name: 'a', chars: 4, estTokens: 1 },
      { name: 'b', chars: 5, estTokens: 5 },
    ]);
    expect(metrics.totalChars).toBe(9);
    expect(metrics.totalEstTokens).toBe(6);
  });

  test('all-empty input yields zero totals and no sections', () => {
    const metrics = computeSectionMetrics({ a: '', b: null });
    expect(metrics.sections).toEqual([]);
    expect(metrics.totalChars).toBe(0);
    expect(metrics.totalEstTokens).toBe(0);
  });

  test('budgeted pair records both raw and injected (budgeted) sizes when clamped', () => {
    const metrics = computeSectionMetrics({
      research: { raw: 'a'.repeat(20), budgeted: 'a'.repeat(8) },
    });
    expect(metrics.sections).toEqual([
      { name: 'research', chars: 8, estTokens: 2, rawChars: 20, rawEstTokens: 5, clamped: true },
    ]);
    // Total reflects what is actually injected (budgeted), not the raw size.
    expect(metrics.totalChars).toBe(8);
  });

  test('budgeted pair marks clamped=false when raw was not truncated', () => {
    const metrics = computeSectionMetrics({
      research: { raw: 'abcd', budgeted: 'abcd' },
    });
    expect(metrics.sections[0]).toEqual({
      name: 'research',
      chars: 4,
      estTokens: 1,
      rawChars: 4,
      rawEstTokens: 1,
      clamped: false,
    });
  });

  test('budgeted pair with both sides empty is excluded', () => {
    const metrics = computeSectionMetrics({
      research: { raw: '', budgeted: null },
      taskInfo: 'abcd',
    });
    expect(metrics.sections.map((s) => s.name)).toEqual(['taskInfo']);
  });
});

describe('recordContextMetrics', () => {
  test('emits one pino info line and one context_section_metrics TimelineEvent', async () => {
    await recordContextMetrics(632, 'implementer', 'comprehensive', { taskInfo: 'abcd' });
    expect(logInfo).toHaveBeenCalledTimes(1);
    expect(appendEvent).toHaveBeenCalledTimes(1);
    const event = appendEvent.mock.calls[0][0] as {
      eventType: string;
      payload: { taskId: number; role: string; mode: string; totalChars: number };
    };
    expect(event.eventType).toBe('context_section_metrics');
    expect(event.payload.taskId).toBe(632);
    expect(event.payload.role).toBe('implementer');
    expect(event.payload.mode).toBe('comprehensive');
    expect(event.payload.totalChars).toBe(4);
  });

  test('resolves (never rejects) when appendEvent rejects', async () => {
    appendEvent.mockImplementation(() => Promise.reject(new Error('db down')));
    await expect(
      recordContextMetrics(632, 'researcher', 'standard', { taskInfo: 'abcd' }),
    ).resolves.toBeUndefined();
  });

  test('resolves (never rejects) when appendEvent throws synchronously', async () => {
    appendEvent.mockImplementation(() => {
      throw new Error('sync failure');
    });
    await expect(
      recordContextMetrics(632, 'verifier', 'lightweight', { taskInfo: 'abcd' }),
    ).resolves.toBeUndefined();
  });
});
