/**
 * decision-ledger/aggregate.test
 *
 * Covers the rollups. The rule worth pinning: accuracy excludes what could not
 * be judged, so an outage cannot read as a collapse in decision quality — and
 * the unjudgeable share is reported separately so it cannot hide either.
 */
import { describe, test, expect } from 'bun:test';
import { summarizeVerdicts, summarizeBy, groupDecisions, totalCostUsd } from './aggregate';
import type { Decision, DecisionVerdict } from './types';

const at = new Date('2026-08-25T15:00:00Z');

function decision(verdict: DecisionVerdict, over: Partial<Decision> = {}): Decision {
  return {
    id: `trace:${Math.random()}`,
    at,
    taskId: 666,
    kind: 'model_tier',
    subject: 'implementer phase',
    predicted: null,
    basis: '',
    outcome: null,
    verdict,
    costUsd: 0,
    source: 'decision_trace',
    ...over,
  };
}

describe('summarizeVerdicts', () => {
  test('counts every state and derives accuracy from the judged ones only', () => {
    const s = summarizeVerdicts([
      decision('correct'),
      decision('correct'),
      decision('wrong'),
      decision('partial'),
      decision('indeterminate'),
      decision('pending'),
    ]);
    expect(s.total).toBe(6);
    expect(s.correct).toBe(2);
    // 2 correct out of 4 judged — the indeterminate and pending rows are excluded.
    expect(s.accuracy).toBeCloseTo(0.5);
    expect(s.indeterminateRate).toBeCloseTo(1 / 6);
  });

  test('an all-outage window reports no accuracy rather than zero', () => {
    const s = summarizeVerdicts([decision('indeterminate'), decision('indeterminate')]);
    expect(s.accuracy).toBeNull();
    expect(s.indeterminateRate).toBe(1);
  });

  test('an empty ledger is not a failing one', () => {
    const s = summarizeVerdicts([]);
    expect(s.total).toBe(0);
    expect(s.accuracy).toBeNull();
    expect(s.indeterminateRate).toBe(0);
  });
});

describe('summarizeBy / groupDecisions', () => {
  test('summarizes each group independently', () => {
    const rows = [
      decision('correct', { subject: 'a' }),
      decision('wrong', { subject: 'a' }),
      decision('correct', { subject: 'b' }),
    ];
    const bySubject = summarizeBy(rows, (d) => d.subject);
    expect(bySubject.get('a')?.accuracy).toBeCloseTo(0.5);
    expect(bySubject.get('b')?.accuracy).toBe(1);
  });

  test('preserves input order within a group', () => {
    const first = decision('correct', { id: 'trace:1' });
    const second = decision('wrong', { id: 'trace:2' });
    const grouped = groupDecisions([first, second], () => 'k');
    expect(grouped.get('k')?.map((d) => d.id)).toEqual(['trace:1', 'trace:2']);
  });
});

describe('totalCostUsd', () => {
  test('sums attributable spend', () => {
    expect(
      totalCostUsd([decision('correct', { costUsd: 1.5 }), decision('wrong', { costUsd: 2 })]),
    ).toBeCloseTo(3.5);
  });
});
