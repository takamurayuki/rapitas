/**
 * Fault Scenario: Stop During Verification
 *
 * A stop request against a task must cancel its pending workflow queue items
 * rather than leave them "running"/"queued" forever. Creates a task on the
 * isolated E2E backend, then calls stop-execution and asserts the response
 * is successful (no live agent needed — the assertion is on the HTTP
 * contract, not the queue-cancellation implementation, which already has
 * dedicated unit coverage in routes/agents/execution/routes/).
 */
import type { ScenarioContext, ScenarioResult } from './common';

/**
 * Runs the stop-during-verification fault scenario.
 *
 * @param ctx - Isolated backend context / 隔離バックエンドのコンテキスト
 * @returns Scenario result / シナリオ結果
 */
export async function run(ctx: ScenarioContext): Promise<ScenarioResult> {
  const createRes = await fetch(`${ctx.baseUrl}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '[fault-injection] stop-during-verification' }),
  });

  if (!createRes.ok) {
    return {
      name: 'stop-during-verification',
      passed: false,
      detail: `task creation failed: HTTP ${createRes.status}`,
    };
  }

  const created = (await createRes.json()) as { id?: number };
  if (!created.id) {
    return {
      name: 'stop-during-verification',
      passed: false,
      detail: 'task creation response had no id',
    };
  }

  const stopRes = await fetch(`${ctx.baseUrl}/tasks/${created.id}/stop-execution`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  if (!stopRes.ok) {
    return {
      name: 'stop-during-verification',
      passed: false,
      detail: `stop-execution failed: HTTP ${stopRes.status}`,
    };
  }

  return {
    name: 'stop-during-verification',
    passed: true,
    detail: `task ${created.id} stop-execution returned HTTP ${stopRes.status}`,
  };
}
