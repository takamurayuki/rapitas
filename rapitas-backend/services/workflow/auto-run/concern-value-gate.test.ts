/**
 * concern-value-gate.test
 *
 * Covers the pure value gate: evidence detection patterns, the severity
 * threshold boundary, the per-source daily quota (incl. batch adoption), the
 * injected saturation predicate, the toggle-OFF pass-through, env fallbacks,
 * and the server-local day boundary helper. No DB mocks needed (受入基準1).
 */
import { describe, test, expect, afterEach } from 'bun:test';
import {
  evaluateConcernValueGate,
  hasEvidenceReference,
  localDayStart,
  resolveMinSeverity,
  resolveSourceDailyCap,
  type ValueGateConcern,
  type ValueGateContext,
} from './concern-value-gate';

function makeConcern(overrides: Partial<ValueGateConcern> = {}): ValueGateConcern {
  return {
    id: 1,
    title: 'ワーカー再起動時にキューが消える',
    detail: '再現ログあり workflow-queue.ts:120 参照',
    severity: 'high',
    location: null,
    originTaskId: null,
    source: 'agent',
    ...overrides,
  };
}

function makeCtx(overrides: Partial<ValueGateContext> = {}): ValueGateContext {
  return {
    enabled: true,
    isSaturatedTitle: () => false,
    convertedTodayBySource: {},
    ...overrides,
  };
}

afterEach(() => {
  delete process.env.RAPITAS_CONCERN_VALUE_MIN_SEVERITY;
  delete process.env.RAPITAS_CONCERN_SOURCE_DAILY_CAP;
});

describe('hasEvidenceReference', () => {
  test('file:line reference in detail counts as evidence', () => {
    expect(
      hasEvidenceReference({ detail: 'foo.ts:42 で落ちる', location: null, originTaskId: null }),
    ).toBe(true);
  });

  test('task number (#N) in detail counts as evidence', () => {
    expect(
      hasEvidenceReference({ detail: 'タスク #557 で発覚', location: null, originTaskId: null }),
    ).toBe(true);
  });

  test('originTaskId alone counts as evidence', () => {
    expect(hasEvidenceReference({ detail: '説明のみ', location: null, originTaskId: 12 })).toBe(
      true,
    );
  });

  test('CI run URL counts as evidence', () => {
    expect(
      hasEvidenceReference({
        detail: 'https://github.com/o/r/actions/runs/123 が赤',
        location: null,
        originTaskId: null,
      }),
    ).toBe(true);
  });

  test('repro-steps heading counts as evidence (JA and EN, case-insensitive)', () => {
    expect(
      hasEvidenceReference({ detail: '## 再現手順\n1. 起動', location: null, originTaskId: null }),
    ).toBe(true);
    expect(
      hasEvidenceReference({
        detail: 'Steps To Reproduce: start the app',
        location: null,
        originTaskId: null,
      }),
    ).toBe(true);
  });

  test('code fence counts as evidence', () => {
    expect(
      hasEvidenceReference({
        detail: 'エラー:\n```\nTypeError\n```',
        location: null,
        originTaskId: null,
      }),
    ).toBe(true);
  });

  test('non-empty location field counts as evidence', () => {
    expect(
      hasEvidenceReference({ detail: '説明のみ', location: 'services/x.ts', originTaskId: null }),
    ).toBe(true);
  });

  test('whitespace-only location does NOT count as evidence', () => {
    expect(hasEvidenceReference({ detail: '説明のみ', location: '   ', originTaskId: null })).toBe(
      false,
    );
  });

  test('a vague concern with no reference has no evidence', () => {
    expect(
      hasEvidenceReference({
        detail: 'なんとなくコードが読みにくい気がする',
        location: null,
        originTaskId: null,
      }),
    ).toBe(false);
  });
});

describe('evaluateConcernValueGate — evidence and severity', () => {
  test('a concern without evidence is rejected as no_evidence', async () => {
    const c = makeConcern({ detail: '曖昧な内容のみ', location: null, originTaskId: null });
    const result = await evaluateConcernValueGate([c], makeCtx());
    expect(result.passed).toHaveLength(0);
    expect(result.rejected).toEqual([{ concern: c, reason: 'no_evidence' }]);
  });

  test('severity boundary: medium passes, low is rejected as below_severity', async () => {
    const medium = makeConcern({ id: 1, severity: 'medium', source: 'a' });
    const low = makeConcern({ id: 2, severity: 'low', source: 'b' });
    const result = await evaluateConcernValueGate([medium, low], makeCtx());
    expect(result.passed.map((c) => c.id)).toEqual([1]);
    expect(result.rejected).toEqual([{ concern: low, reason: 'below_severity' }]);
  });

  test('urgent and high pass the default threshold', async () => {
    const result = await evaluateConcernValueGate(
      [
        makeConcern({ id: 1, severity: 'urgent', source: 'a' }),
        makeConcern({ id: 2, severity: 'high', source: 'b' }),
      ],
      makeCtx(),
    );
    expect(result.passed.map((c) => c.id)).toEqual([1, 2]);
  });

  test('evidence is checked before severity (first failing check names the reason)', async () => {
    const c = makeConcern({ detail: '曖昧', severity: 'low' });
    const result = await evaluateConcernValueGate([c], makeCtx());
    expect(result.rejected[0].reason).toBe('no_evidence');
  });
});

describe('evaluateConcernValueGate — saturation predicate', () => {
  test('a saturated title is rejected as saturated', async () => {
    const c = makeConcern();
    const result = await evaluateConcernValueGate([c], makeCtx({ isSaturatedTitle: () => true }));
    expect(result.rejected).toEqual([{ concern: c, reason: 'saturated' }]);
  });

  test('an async saturation predicate is awaited', async () => {
    const c = makeConcern();
    const result = await evaluateConcernValueGate(
      [c],
      makeCtx({ isSaturatedTitle: () => Promise.resolve(true) }),
    );
    expect(result.rejected[0].reason).toBe('saturated');
  });
});

describe('evaluateConcernValueGate — source daily quota', () => {
  test('1st and 2nd of a source pass, the 3rd is rejected as source_quota', async () => {
    const batch = [1, 2, 3].map((id) => makeConcern({ id, source: 'log_health' }));
    const result = await evaluateConcernValueGate(batch, makeCtx());
    expect(result.passed.map((c) => c.id)).toEqual([1, 2]);
    expect(result.rejected).toEqual([{ concern: batch[2], reason: 'source_quota' }]);
  });

  test('quotas are independent per source', async () => {
    const batch = [
      makeConcern({ id: 1, source: 'log_health' }),
      makeConcern({ id: 2, source: 'log_health' }),
      makeConcern({ id: 3, source: 'ci_watch' }),
    ];
    const result = await evaluateConcernValueGate(batch, makeCtx());
    expect(result.passed.map((c) => c.id)).toEqual([1, 2, 3]);
  });

  test("today's already-converted count consumes the quota before the batch", async () => {
    const batch = [makeConcern({ id: 1, source: 'log_health' })];
    const result = await evaluateConcernValueGate(
      batch,
      makeCtx({ convertedTodayBySource: { log_health: 2 } }),
    );
    expect(result.passed).toHaveLength(0);
    expect(result.rejected[0].reason).toBe('source_quota');
  });

  test('an empty source falls back to the "unknown" bucket', async () => {
    const batch = [
      makeConcern({ id: 1, source: '' }),
      makeConcern({ id: 2, source: '' }),
      makeConcern({ id: 3, source: '' }),
    ];
    const result = await evaluateConcernValueGate(batch, makeCtx());
    expect(result.passed.map((c) => c.id)).toEqual([1, 2]);
    expect(result.rejected[0].reason).toBe('source_quota');
  });
});

describe('evaluateConcernValueGate — toggle', () => {
  test('enabled:false passes everything through unchanged (旧挙動)', async () => {
    const batch = [
      makeConcern({ id: 1, detail: '曖昧', severity: 'low' }),
      makeConcern({ id: 2, source: 'log_health' }),
      makeConcern({ id: 3, source: 'log_health' }),
      makeConcern({ id: 4, source: 'log_health' }),
    ];
    const result = await evaluateConcernValueGate(
      batch,
      makeCtx({ enabled: false, isSaturatedTitle: () => true }),
    );
    expect(result.passed).toHaveLength(4);
    expect(result.rejected).toHaveLength(0);
  });
});

describe('env thresholds', () => {
  test('RAPITAS_CONCERN_VALUE_MIN_SEVERITY overrides the threshold', async () => {
    process.env.RAPITAS_CONCERN_VALUE_MIN_SEVERITY = 'low';
    const result = await evaluateConcernValueGate([makeConcern({ severity: 'low' })], makeCtx());
    expect(result.passed).toHaveLength(1);
  });

  test('invalid min-severity falls back to medium', () => {
    process.env.RAPITAS_CONCERN_VALUE_MIN_SEVERITY = 'catastrophic';
    expect(resolveMinSeverity()).toBe('medium');
  });

  test('RAPITAS_CONCERN_SOURCE_DAILY_CAP overrides the cap; invalid falls back to 2', async () => {
    process.env.RAPITAS_CONCERN_SOURCE_DAILY_CAP = '1';
    const batch = [makeConcern({ id: 1 }), makeConcern({ id: 2 })];
    const result = await evaluateConcernValueGate(batch, makeCtx());
    expect(result.passed.map((c) => c.id)).toEqual([1]);

    process.env.RAPITAS_CONCERN_SOURCE_DAILY_CAP = 'not-a-number';
    expect(resolveSourceDailyCap()).toBe(2);
    process.env.RAPITAS_CONCERN_SOURCE_DAILY_CAP = '0';
    expect(resolveSourceDailyCap()).toBe(2);
  });
});

describe('localDayStart — day boundary (server-local 0:00)', () => {
  test('just before and after local midnight land on different days', () => {
    const before = new Date(2026, 7, 11, 23, 59, 59);
    const after = new Date(2026, 7, 12, 0, 0, 1);
    expect(localDayStart(before).getTime()).toBe(new Date(2026, 7, 11).getTime());
    expect(localDayStart(after).getTime()).toBe(new Date(2026, 7, 12).getTime());
    expect(localDayStart(before).getTime()).not.toBe(localDayStart(after).getTime());
  });

  test('the boundary is local midnight, not a UTC offset', () => {
    const d = localDayStart(new Date(2026, 0, 15, 12, 30));
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getDate()).toBe(15);
  });
});
