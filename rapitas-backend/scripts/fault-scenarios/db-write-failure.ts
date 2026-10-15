/**
 * Fault Scenario: DB Write Failure
 *
 * When the database rejects a write, the API must surface a failure rather
 * than reporting a task as created/completed. Injects a failure by POSTing a
 * deliberately invalid payload (missing the required `title`) and asserts
 * the isolated backend responds with an error status instead of a fabricated
 * success.
 */
import type { ScenarioContext, ScenarioResult } from './common';

/**
 * Runs the db-write-failure fault scenario.
 *
 * @param ctx - Isolated backend context / 隔離バックエンドのコンテキスト
 * @returns Scenario result / シナリオ結果
 */
export async function run(ctx: ScenarioContext): Promise<ScenarioResult> {
  const res = await fetch(`${ctx.baseUrl}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  if (res.ok) {
    return {
      name: 'db-write-failure',
      passed: false,
      detail: `expected the write to be rejected but got HTTP ${res.status}`,
    };
  }

  return {
    name: 'db-write-failure',
    passed: true,
    detail: `invalid write correctly rejected with HTTP ${res.status}`,
  };
}
