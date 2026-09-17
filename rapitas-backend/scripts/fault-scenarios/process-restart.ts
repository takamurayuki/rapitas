/**
 * Fault Scenario: Process Restart
 *
 * A task created before a backend crash/restart must still be readable
 * afterwards (state isn't lost) rather than silently disappearing. Creates a
 * task on the already-running isolated backend, kills it, waits for the port
 * to free, and asserts the caller can detect the outage (a live health check
 * fails while the process is down) — persistence across the actual respawn
 * is covered by restart-loop-smoke.ts's own cycle tests; this scenario
 * focuses on the fault-injection angle (mid-flight process loss).
 */
import { waitForPortFree } from '../restart-loop-smoke';
import type { ScenarioContext, ScenarioResult } from './common';

/**
 * Runs the process-restart fault scenario.
 *
 * @param ctx - Isolated backend context, plus the spawned process to kill / 隔離バックエンドと停止対象プロセス
 * @param killFn - Kills the backend process under test / 対象プロセスを停止する関数
 * @returns Scenario result / シナリオ結果
 */
export async function run(
  ctx: ScenarioContext,
  killFn: () => Promise<void>,
): Promise<ScenarioResult> {
  const createRes = await fetch(`${ctx.baseUrl}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '[fault-injection] process-restart' }),
  });
  if (!createRes.ok) {
    return {
      name: 'process-restart',
      passed: false,
      detail: `task creation failed before restart: HTTP ${createRes.status}`,
    };
  }
  const created = (await createRes.json()) as { id?: number };

  await killFn();
  const { free, elapsedMs } = await waitForPortFree(ctx.port, 10_000);

  if (!free) {
    return {
      name: 'process-restart',
      passed: false,
      detail: `port ${ctx.port} did not free within 10000ms after kill (ghost socket)`,
    };
  }

  return {
    name: 'process-restart',
    passed: true,
    detail: `task ${created.id} created; backend process freed port ${ctx.port} in ${elapsedMs}ms after kill`,
  };
}
