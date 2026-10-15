import { describe, expect, test } from 'bun:test';
import { computeKnowledgeReuseComparison, type TaskOutcome } from './knowledge-reuse-evaluator';

function outcome(taskId: number, success: boolean, uncertain = false): TaskOutcome {
  return { taskId, success, uncertain };
}

describe('computeKnowledgeReuseComparison', () => {
  test('empty input — no groups, insufficient', () => {
    const result = computeKnowledgeReuseComparison([], new Map());
    expect(result).toEqual({
      pairedN: 0,
      missingRetainedN: 0,
      successRateWithKB: null,
      successRateWithoutKB: null,
      effectSize: null,
      intervalOrPValue: null,
      sufficientEvidence: false,
    });
  });

  test('tasks with unknown treatment are excluded entirely', () => {
    const outcomes = [outcome(1, true), outcome(2, false)];
    const treatments = new Map<number, boolean>(); // neither task has a treatment record
    const result = computeKnowledgeReuseComparison(outcomes, treatments);
    expect(result.pairedN).toBe(0);
  });

  test('one-sided group (all treated) — the other rate is null, insufficient', () => {
    const outcomes = [outcome(1, true), outcome(2, false)];
    const treatments = new Map([
      [1, true],
      [2, true],
    ]);
    const result = computeKnowledgeReuseComparison(outcomes, treatments);
    expect(result.successRateWithKB).toBe(0.5);
    expect(result.successRateWithoutKB).toBeNull();
    expect(result.sufficientEvidence).toBe(false);
  });

  test('below the per-group minimum — rates computed but insufficient', () => {
    const outcomes = [outcome(1, true), outcome(2, false)];
    const treatments = new Map([
      [1, true],
      [2, false],
    ]);
    const result = computeKnowledgeReuseComparison(outcomes, treatments);
    expect(result.pairedN).toBe(2);
    expect(result.successRateWithKB).toBe(1);
    expect(result.successRateWithoutKB).toBe(0);
    expect(result.effectSize).toBe(1);
    expect(result.intervalOrPValue).not.toBeNull();
    expect(result.sufficientEvidence).toBe(false); // n=1/1, well under MIN_GROUP_N
  });

  test('meets the per-group minimum with a real difference — sufficient evidence', () => {
    const outcomes: TaskOutcome[] = [];
    const treatments = new Map<number, boolean>();
    // 12 tasks WITH memory: 9 succeed (0.75)
    for (let i = 1; i <= 12; i++) {
      outcomes.push(outcome(i, i <= 9));
      treatments.set(i, true);
    }
    // 12 tasks WITHOUT memory: 4 succeed (0.333)
    for (let i = 101; i <= 112; i++) {
      outcomes.push(outcome(i, i <= 104));
      treatments.set(i, false);
    }
    const result = computeKnowledgeReuseComparison(outcomes, treatments);
    expect(result.pairedN).toBe(24);
    expect(result.successRateWithKB).toBeCloseTo(0.75, 2);
    expect(result.successRateWithoutKB).toBeCloseTo(0.333, 2);
    expect(result.effectSize).toBeCloseTo(0.417, 2);
    expect(result.sufficientEvidence).toBe(true);
  });

  test('uncertain (pending/unobservable) outcomes are retained as non-success, counted in missingRetainedN', () => {
    const outcomes = [
      outcome(1, true),
      outcome(2, false, true), // pending landing — retained, counts as not-success
    ];
    const treatments = new Map([
      [1, true],
      [2, true],
    ]);
    const result = computeKnowledgeReuseComparison(outcomes, treatments);
    expect(result.missingRetainedN).toBe(1);
    expect(result.successRateWithKB).toBe(0.5); // the pending case pulls the rate down, not excluded
  });
});
