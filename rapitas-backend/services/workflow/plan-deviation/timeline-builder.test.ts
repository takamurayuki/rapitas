/**
 * timeline-builder tests
 */
import { describe, expect, test } from 'bun:test';
import { buildDeviationTimeline, isSupportedProvider } from './timeline-builder';
import type { OperationRecord } from './types';

const PLAN =
  '```json:plan-declaration\n{"version":1,"files":["src/**"],"commands":["bun"],"externalHosts":[]}\n```';

const ops: OperationRecord[] = [
  {
    seq: 1,
    occurredAt: '2026-10-13T00:00:01.000Z',
    kind: 'file_change',
    tool: 'Write',
    features: { path: 'src/a.ts' },
    displayMasked: 'Write: src/a.ts',
    logSequence: 4,
  },
  {
    seq: 2,
    occurredAt: '2026-10-13T00:00:02.000Z',
    kind: 'command',
    tool: 'Bash',
    features: { commandNames: ['rm'] },
    displayMasked: 'Bash: rm -rf x',
    logSequence: 9,
  },
];

describe('buildDeviationTimeline', () => {
  test('ok: classified entries, counts and plan hash', () => {
    const t = buildDeviationTimeline({
      planContent: PLAN,
      operations: ops,
      executionTerminal: true,
    });
    expect(t.status).toBe('ok');
    expect(t.entries.map((e) => e.category)).toEqual([
      'in_plan',
      'out_of_plan',
      'planned_not_executed',
    ]);
    expect(t.counts).toEqual({ inPlan: 1, outOfPlan: 1, plannedNotExecuted: 1 });
    expect(t.byKind).toEqual({ file_change: 0, command: 2, http: 0 });
    expect(t.planHash).toHaveLength(16);
  });

  test('ambiguous plan: warning, no entries, no counts', () => {
    const t = buildDeviationTimeline({
      planContent: '# 計画のみ',
      operations: ops,
      executionTerminal: true,
    });
    expect(t.status).toBe('ambiguous');
    expect(t.entries).toEqual([]);
    expect(t.counts).toBeNull();
    expect(t.warnings.some((w) => w.includes('ambiguous'))).toBe(true);
  });

  test('no operations recorded → no_operations', () => {
    const t = buildDeviationTimeline({
      planContent: PLAN,
      operations: [],
      executionTerminal: true,
    });
    expect(t.status).toBe('no_operations');
    expect(t.counts).toBeNull();
  });

  test('non-Claude provider → unsupported_provider', () => {
    const t = buildDeviationTimeline({
      planContent: PLAN,
      operations: ops,
      executionTerminal: true,
      agentType: 'codex',
    });
    expect(t.status).toBe('unsupported_provider');
    expect(t.entries).toEqual([]);
  });

  test('store and parse warnings are surfaced', () => {
    const t = buildDeviationTimeline({
      planContent: '```json:plan-declaration\n{bad\n```\n## 変更予定ファイル\n- `src/a.ts`',
      operations: ops,
      operationWarnings: ['truncated: x'],
      executionTerminal: false,
    });
    expect(t.status).toBe('ok');
    expect(t.warnings.length).toBe(2);
  });
});

describe('isSupportedProvider', () => {
  test('claude family and unknown are supported; codex/gemini are not', () => {
    expect(isSupportedProvider('claude-code')).toBe(true);
    expect(isSupportedProvider(null)).toBe(true);
    expect(isSupportedProvider('codex')).toBe(false);
    expect(isSupportedProvider('gemini')).toBe(false);
  });
});
