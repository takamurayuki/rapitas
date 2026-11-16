/**
 * verify-hard-fail-repair
 *
 * The CLI/orchestrator verify epilogue's handling of a HARD validation failure
 * of verify.md: bounce into the bounded verify→implement self-repair loop, or
 * block durably when repairs are exhausted. Extracted unchanged from
 * workflow-cli-executor-verify-gate.ts (file-size split). Not responsible for
 * the passing-verify completion path.
 */
import { createLogger } from '../../config/logger';
import type { readWorkflowFile } from './workflow-file-utils';
import type { ValidationResult } from './phase-output-validator';
import type { RoleTransition, WorkflowAdvanceResult } from './workflow-types';
import { recordTransition, type TransitionActor } from './transition-recorder';
import { writeBlockedStatusDurable } from './durable-blocked-write';

// NOTE: Same logger name as the executor body — keeps the observed log `name`
// field identical after the file split.
const log = createLogger('workflow-cli-executor');

/**
 * Resolve the phase status for a verify.md that failed validation hard.
 *
 * @param params - Task, transition, session, evaluated status, artifact, validation / 入力一式
 * @returns The phase status the epilogue should report / エピローグが報告するフェーズステータス
 */
export async function resolveHardFailVerify(params: {
  taskId: number;
  transition: RoleTransition;
  session: { id: number };
  currentWfStatus: string;
  fileContent: Awaited<ReturnType<typeof readWorkflowFile>>;
  validation: ValidationResult;
}): Promise<WorkflowAdvanceResult['status']> {
  const { taskId, transition, session, currentWfStatus, fileContent, validation } = params;
  // Give the CLI/orchestrator-driven epilogue the same self-repair chance
  // as the HTTP save path (status-transition.ts) — previously this branch
  // blocked directly, so every hard-fail evaluated here consumed a blind
  // blocked_auto_retry instead of the bounded verify→implement repair
  // budget, delaying escalation to the existing verify_repair_exhausted /
  // verify_no_convergence classification (task 705, task #684 timeline).
  const { attemptVerifyRepair } = await import('./verify-self-repair');
  const repair = await attemptVerifyRepair(
    taskId,
    currentWfStatus,
    validation.summary,
    typeof fileContent === 'string' ? fileContent : '',
  );

  if (repair.bounced && repair.newStatus) {
    log.warn(
      { taskId, attempt: repair.attempt, newStatus: repair.newStatus },
      '[WorkflowCLIExecutor] verify hard-fail — re-running implement→verify (self-repair)',
    );
    return repair.newStatus as WorkflowAdvanceResult['status'];
  } else if (repair.stale) {
    // The workflow advanced past the evaluated status while this verdict
    // was in flight — neither bounce nor block (task 551 CAS pattern).
    return currentWfStatus as WorkflowAdvanceResult['status'];
  } else {
    // This write is what actually STOPS the verify hard-fail loop, so a
    // swallowed failure here (mirroring the workflow-orchestrator
    // plan-replan incident) could let the task re-enter verify on the
    // next poll. Retry once, then notify a human on continued failure.
    await writeBlockedStatusDurable({
      taskId,
      log,
      source: 'WorkflowCLIExecutor',
      notification: {
        title: 'ブロック処理の書き込みに失敗',
        message: `タスク #${taskId} を blocked にする更新が2回失敗しました（検証バリデーション不合格）。手動確認が必要です。`,
      },
    });
    // Skip when attemptVerifyRepair() already recorded its own terminal
    // transition (non-convergence cutoff) — avoids double-recording one
    // verify failure as two transitions (task 705).
    if (!repair.cutoffRecorded) {
      await recordTransition({
        taskId,
        fromStatus: currentWfStatus,
        toStatus: currentWfStatus,
        actor: transition.role as TransitionActor,
        cause: 'verify_validation_failed',
        phase: 'verify',
        sessionId: session.id,
        metadata: { reason: validation.summary },
        invariantViolation: true,
        invariantMessage: validation.summary,
      });
    }
    return currentWfStatus as WorkflowAdvanceResult['status'];
  }
}
