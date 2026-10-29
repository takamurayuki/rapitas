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

const { estimateTokens, computeSectionMetrics, recordContextMetrics, fingerprint } =
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
      { name: 'a', chars: 4, estTokens: 1, hash: fingerprint('abcd') },
      { name: 'b', chars: 5, estTokens: 5, hash: fingerprint('あいうえお') },
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
      {
        name: 'research',
        chars: 8,
        estTokens: 2,
        rawChars: 20,
        rawEstTokens: 5,
        clamped: true,
        hash: fingerprint('a'.repeat(8)),
      },
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
      hash: fingerprint('abcd'),
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

describe('the section fingerprint', () => {
  // The gap this closes, measured 2026-10-21: 206 same-task re-runs of the
  // same phase appeared to move the retrieved block by 0.2-0.7%, computed
  // from `chars`. Two different memories of the same length were recorded
  // identically, so that number could only ever have been a lower bound.
  test('tells apart two sections of the same length', () => {
    const a = computeSectionMetrics({ memory: 'AAAA' });
    const b = computeSectionMetrics({ memory: 'BBBB' });
    expect(a.sections[0]?.chars).toBe(b.sections[0]?.chars);
    expect(a.sections[0]?.hash).not.toBe(b.sections[0]?.hash);
  });

  test('is the same for the same text, so a stable run reads as stable', () => {
    const a = computeSectionMetrics({ memory: '同じ記憶' });
    const b = computeSectionMetrics({ memory: '同じ記憶' });
    expect(a.sections[0]?.hash).toBe(b.sections[0]?.hash);
  });

  test('covers every recorded section, not just some', () => {
    const metrics = computeSectionMetrics({
      taskInfo: 'a',
      memory: 'b',
      plan: 'c',
    });
    expect(metrics.sections).toHaveLength(3);
    expect(metrics.sections.every((x) => /^[0-9a-f]{12}$/.test(x.hash))).toBe(true);
  });

  test('fingerprints what was injected, not what was clamped away', () => {
    // The model saw the budgeted text. Hashing the raw one would say the
    // run used content it never got.
    const clamped = computeSectionMetrics({
      research: { raw: 'LONG ORIGINAL TEXT', budgeted: 'SHORT' },
    });
    expect(clamped.sections[0]?.hash).toBe(fingerprint('SHORT'));
    expect(clamped.sections[0]?.hash).not.toBe(fingerprint('LONG ORIGINAL TEXT'));
  });

  test('is short enough to read and long enough to separate', () => {
    expect(fingerprint('x')).toHaveLength(12);
    expect(fingerprint('x')).not.toBe(fingerprint('y'));
  });

  test('does not carry the text itself into the record', () => {
    // A prompt log would quietly become a second copy of the knowledge base.
    const secret = '社外秘の記憶の中身';
    const metrics = computeSectionMetrics({ memory: secret });
    expect(JSON.stringify(metrics)).not.toContain(secret);
  });
});
