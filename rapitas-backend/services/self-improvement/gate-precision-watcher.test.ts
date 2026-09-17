import { describe, expect, test } from 'bun:test';
import { evaluateGatePrecisionRule, type GatePrecisionDisputeRow } from './gate-precision-watcher';

function rows(verdicts: string[]): GatePrecisionDisputeRow[] {
  return verdicts.map((verdict, i) => ({
    verdict,
    taskId: 100 + i,
    criterionIndex: 1,
    reason: `reason ${i}`,
  }));
}

describe('evaluateGatePrecisionRule', () => {
  test('below the minimum sample size — no finding', () => {
    const out = rows(['resolved_by_human', 'resolved_by_human', 'resolved_by_human']);
    expect(evaluateGatePrecisionRule(out)).toBeNull();
  });

  test('enough sample but the disputed rate is under threshold — no finding', () => {
    // 1/6 = ~17%, below the 40% threshold
    const out = rows([
      'resolved_by_human',
      'resolved_by_implementation',
      'resolved_by_implementation',
      'resolved_by_implementation',
      'resolved_by_implementation',
      'resolved_by_implementation',
    ]);
    expect(evaluateGatePrecisionRule(out)).toBeNull();
  });

  test('enough sample and a high disputed rate — fires with correct rate', () => {
    // 3/5 = 60%, above the 40% threshold
    const out = rows([
      'resolved_by_human',
      'unresolved_blocked',
      'resolved_by_human',
      'resolved_by_implementation',
      'resolved_by_implementation',
    ]);
    const finding = evaluateGatePrecisionRule(out);
    expect(finding).not.toBeNull();
    expect(finding!.sample).toBe(5);
    expect(finding!.humanOrBlockedRate).toBeCloseTo(0.6);
  });

  test('examples are capped at 5 even with a larger disputed set', () => {
    const out = rows(new Array(8).fill('resolved_by_human'));
    const finding = evaluateGatePrecisionRule(out);
    expect(finding).not.toBeNull();
    expect(finding!.examplesSummary.split('\n')).toHaveLength(5);
  });
});
