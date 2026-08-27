/**
 * Workflow Orchestrator — Preflight Probe
 *
 * Stage inserted between agent-prep and plan-guard in runAdvanceWorkflow
 * (task 673): runs the DB and agent-endpoint probes (in parallel) before a
 * phase transition proceeds. A cache hit skips re-probing entirely. Success
 * lets the workflow continue unchanged; a permanent failure on any target
 * stops the transition, records the attempt, and escalates via probe-alert.
 * Not responsible for role resolution, plan validation or execution — those
 * are the sibling preflight/agent-prep/plan-guard/execute stages.
 */
import { createLogger } from '../../config/logger';
import { alertPermanentProbeFailure } from './probe/probe-alert';
import { getCachedProbeResult, setCachedProbeResult } from './probe/probe-cache';
import { runProbeWithRetry } from './probe/probe-retry';
import { PROBE_TARGETS } from './probe/probe-targets';
import type { ProbeAgentConfig } from './probe/probe.types';
import { recordProbeAttempt } from '../ai/probe-metrics';
import type { WorkflowAdvanceResult, WorkflowRole, WorkflowStatus } from './workflow-types';

const log = createLogger('workflow-orchestrator');

/**
 * Runs the preflight probe stage. Returns `{ done: true, result }` when a
 * target permanently fails (transition must not proceed), otherwise
 * `{ done: false }` to let runAdvanceWorkflow continue to plan-guard.
 *
 * @param taskId - The task whose workflow should advance. / ワークフローを進めるタスクID
 * @param role - Role about to run (from the transition resolved by preflight/agent-prep). / 実行予定のロール
 * @param agentConfig - Agent resolved by prepareAgentAndPrompt. / 解決済みエージェント設定
 * @param currentStatus - Current workflow status, preserved on a permanent-failure early return. / 現在のワークフローステータス
 * @returns `{ done: true, result }` for an early return, otherwise `{ done: false }`. / 早期終了結果または続行指示
 */
export async function runPreflightProbe(
  taskId: number,
  role: WorkflowRole,
  agentConfig: ProbeAgentConfig,
  currentStatus: WorkflowStatus,
) {
  const nowMs = Date.now();

  const results = await Promise.all(
    PROBE_TARGETS.map(async (target) => {
      const cached = getCachedProbeResult(taskId, target.id, nowMs);
      if (cached !== null)
        return { target, outcome: cached, attempts: 0, errorMessage: null as string | null };

      const retryResult = await runProbeWithRetry(target, { taskId, role, agentConfig }, nowMs);
      setCachedProbeResult(taskId, target.id, retryResult.outcome, nowMs);
      recordProbeAttempt({
        tsMs: nowMs,
        taskId,
        role,
        targetId: target.id,
        outcome: retryResult.outcome,
        attempts: retryResult.attempts,
        latencyMs: retryResult.latencyMs,
        errorMessage: retryResult.errorMessage,
      });
      return {
        target,
        outcome: retryResult.outcome,
        attempts: retryResult.attempts,
        errorMessage: retryResult.errorMessage,
      };
    }),
  );

  const failed = results.find((r) => r.outcome === 'permanent_failure');
  if (!failed) {
    return { done: false as const };
  }

  log.warn(
    { taskId, role, targetId: failed.target.id, errorMessage: failed.errorMessage },
    '[workflow-orchestrator-preflight-probe] Permanent probe failure — blocking task transition',
  );
  await alertPermanentProbeFailure(taskId, failed.target.id, role, failed.errorMessage);

  const result: WorkflowAdvanceResult = {
    success: false,
    role,
    status: currentStatus,
    error: `フェーズ遷移前のprobe（対象: ${failed.target.id}）が永続的に失敗したため、タスクをブロックしました: ${failed.errorMessage ?? '(不明)'}`,
  };
  return { done: true as const, result };
}
