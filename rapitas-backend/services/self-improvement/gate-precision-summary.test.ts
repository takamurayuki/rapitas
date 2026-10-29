/**
 * gate-precision-summary unit tests
 *
 * The ledger classifies how a gate's bounce resolved, but nothing reads it
 * back: the rows go into agent prompts and nowhere a person can look. So the
 * one question the published article left open — how many of the review's
 * fails deserved to be fails — could only be answered with a throwaway
 * script.
 *
 * What these tests mostly pin down is what the summary must NOT claim. There
 * is no ground truth here: nobody labelled any bounce correct or incorrect.
 * A share of disputes the implementer could resolve alone is evidence about
 * precision, not a measurement of it, and the names have to say so.
 */
import { describe, test, expect } from 'bun:test';
import { summariseGatePrecision, type PrecisionRow } from './gate-precision-summary';

const row = (verdict: string, over: Partial<PrecisionRow> = {}): PrecisionRow => ({
  gate: 'verify_repair',
  verdict,
  reason: null,
  taskId: 1,
  ...over,
});

describe('counting', () => {
  test('breaks the rows down by verdict', () => {
    const s = summariseGatePrecision([
      row('resolved_by_implementation'),
      row('resolved_by_implementation'),
      row('unresolved_blocked'),
      row('resolved_by_human'),
    ]);
    expect(s.total).toBe(4);
    expect(s.byVerdict).toEqual({
      resolved_by_implementation: 2,
      unresolved_blocked: 1,
      resolved_by_human: 1,
    });
  });

  test('counts distinct tasks, not rows', () => {
    // One task can raise several disputes; a per-row count would overstate
    // how much of the backlog this says anything about.
    const s = summariseGatePrecision([
      row('resolved_by_implementation', { taskId: 7 }),
      row('resolved_by_implementation', { taskId: 7 }),
      row('unresolved_blocked', { taskId: 9 }),
    ]);
    expect(s.total).toBe(3);
    expect(s.tasks).toBe(2);
  });

  test('separates the gates', () => {
    const s = summariseGatePrecision([
      row('resolved_by_implementation', { gate: 'verify_repair' }),
      row('unresolved_blocked', { gate: 'ci_repair' }),
    ]);
    expect(s.byGate).toEqual({ verify_repair: 1, ci_repair: 1 });
  });

  test('counts the ones the adversarial review raised', () => {
    // The article's open question is about that gate specifically, and the
    // ledger records it under verify_repair with the reason as the only tell.
    const s = summariseGatePrecision([
      row('resolved_by_implementation', { reason: '差分レビュー不合格: 受入基準1 …' }),
      row('unresolved_blocked', { reason: '差分レビュー不合格: 受入基準3 …' }),
      row('resolved_by_human', { reason: 'verify.md explicitly reports a failure' }),
    ]);
    expect(s.fromAdversarialReview).toBe(2);
  });
});

describe('what it refuses to claim', () => {
  test('reports shares as null when there is nothing to divide', () => {
    // 0% would read as a measured zero. There is no measurement here.
    const s = summariseGatePrecision([]);
    expect(s.total).toBe(0);
    expect(s.actionableShare).toBeNull();
    expect(s.unresolvedShare).toBeNull();
  });

  test('names the share for what it is, not precision', () => {
    const s = summariseGatePrecision([
      row('resolved_by_implementation'),
      row('resolved_by_implementation'),
      row('resolved_by_implementation'),
      row('unresolved_blocked'),
    ]);
    // Resolved by the implementer alone — evidence the bounce was actionable,
    // not proof the gate was right.
    expect(s.actionableShare).toBeCloseTo(0.75, 6);
    expect(s.unresolvedShare).toBeCloseTo(0.25, 6);
    expect(s).not.toHaveProperty('precision');
  });

  test('a verdict it has never seen still shows up', () => {
    // A new verdict added upstream must appear rather than be dropped into
    // a known bucket — the same reason an unlabelled unknown is never
    // folded into a neighbour.
    const s = summariseGatePrecision([row('something_new')]);
    expect(s.byVerdict).toEqual({ something_new: 1 });
    expect(s.actionableShare).toBe(0);
  });
});
