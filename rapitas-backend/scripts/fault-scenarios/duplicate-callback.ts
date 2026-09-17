/**
 * Fault Scenario: Duplicate Callback
 *
 * Sending the same stop-execution callback twice for one task must not
 * double-apply side effects. Creates a task, calls stop-execution twice in a
 * row, and asserts BOTH calls return a successful, idempotent response
 * rather than the second call erroring or duplicating state.
 */
import type { ScenarioContext, ScenarioResult } from './common';

/**
 * Runs the duplicate-callback fault scenario.
 *
 * @param ctx - Isolated backend context / 隔離バックエンドのコンテキスト
 * @returns Scenario result / シナリオ結果
 */
export async function run(ctx: ScenarioContext): Promise<ScenarioResult> {
  const createRes = await fetch(`${ctx.baseUrl}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '[fault-injection] duplicate-callback' }),
  });
  if (!createRes.ok) {
    return {
      name: 'duplicate-callback',
      passed: false,
      detail: `task creation failed: HTTP ${createRes.status}`,
    };
  }
  const created = (await createRes.json()) as { id?: number };
  if (!created.id) {
    return { name: 'duplicate-callback', passed: false, detail: 'task creation had no id' };
  }

  const callOnce = () =>
    fetch(`${ctx.baseUrl}/tasks/${created.id}/stop-execution`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

  const first = await callOnce();
  const second = await callOnce();

  if (!first.ok || !second.ok) {
    return {
      name: 'duplicate-callback',
      passed: false,
      detail: `expected both calls to succeed idempotently, got HTTP ${first.status}/${second.status}`,
    };
  }

  return {
    name: 'duplicate-callback',
    passed: true,
    detail: `task ${created.id}: duplicate stop-execution calls both returned HTTP ${first.status}`,
  };
}
