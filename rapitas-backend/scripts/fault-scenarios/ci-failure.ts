/**
 * Fault Scenario: CI Failure Blocks Auto-Merge
 *
 * A PR with a failed blocking CI check must never be auto-merged. Exercises
 * the production decision function directly (services/workflow/
 * auto-merge-checks.ts) with a synthetic failed-check payload.
 */
import { evaluateAutoMergeChecks, type PrCheck } from '../../services/workflow/auto-merge-checks';
import type { ScenarioContext, ScenarioResult } from './common';

/**
 * Runs the ci-failure fault scenario.
 *
 * @param _ctx - Unused; scenario exercises a pure function / 未使用（純粋関数のみ検証）
 * @returns Scenario result / シナリオ結果
 */
export async function run(_ctx: ScenarioContext): Promise<ScenarioResult> {
  const blocking = new Set(['Lint Code', 'Full Suite']);
  const checks: PrCheck[] = [
    { name: 'Lint Code', bucket: 'pass' },
    { name: 'Full Suite', bucket: 'fail' },
  ];

  const state = evaluateAutoMergeChecks(checks, blocking);

  if (state !== 'fail') {
    return {
      name: 'ci-failure',
      passed: false,
      detail: `expected aggregate state 'fail' with one failing blocking check, got '${state}'`,
    };
  }

  return {
    name: 'ci-failure',
    passed: true,
    detail: `aggregate state correctly reported as 'fail' — auto-merge would be blocked`,
  };
}
