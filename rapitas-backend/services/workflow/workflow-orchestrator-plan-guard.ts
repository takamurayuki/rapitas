/**
 * Workflow Orchestrator — Plan Validity Guard
 *
 * Third stage of runAdvanceWorkflow: before the implementer runs in a mode
 * that has a plan phase, re-validate plan.md and roll back to re-plan (bounded
 * by MAX_PLAN_REPLANS, then block). Moved verbatim from
 * workflow-orchestrator.ts (file-size ratchet, task 627); behavior is unchanged.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import { readWorkflowFile, archiveWorkflowFile } from './workflow-file-utils';
import type { WorkflowAdvanceResult } from './workflow-agent-executor';
import { isReusableArtifact } from './phase-output-validator';
import { recordTransition } from './transition-recorder';
import type { RoleTransition, WorkflowMode, WorkflowStatus } from './workflow-types';
import { countWithFailClosed } from '../../utils/database/fail-closed-count';
import { writeBlockedStatusDurable } from './durable-blocked-write';
import { scheduleWorkflowRedispatch } from './workflow-redispatch';

const log = createLogger('workflow-orchestrator');

/**
 * Max times the implementer guard may roll back to re-plan a task whose plan.md
 * keeps coming back invalid. Beyond this the task is blocked instead of looping
 * (draft→…→plan_approved→rollback) forever. / 再計画ロールバックの上限。
 */
const MAX_PLAN_REPLANS = 3;

/**
 * Guards the implementer against a broken plan.md. Returns `{ done: false }`
 * when the guard does not apply or the plan is usable.
 *
 * @param taskId - The task whose workflow should advance. / ワークフローを進めるタスクID
 * @param transition - Transition about to execute. / 実行予定の遷移
 * @param workflowMode - Effective workflow mode. / 有効なワークフローモード
 * @param language - Language for the re-dispatch. / 再ディスパッチの言語
 * @returns `{ done: true, result }` when rolled back or blocked, else `{ done: false }`. / ロールバック/ブロック時は早期終了結果
 */
export async function guardPlanValidity(
  taskId: number,
  transition: RoleTransition,
  workflowMode: WorkflowMode,
  language: 'ja' | 'en',
) {
  // Guard against implementing on a BROKEN plan. plan.md/research.md approved
  // BEFORE the log-pollution checks existed (or auto-approved garbage) can be
  // pure agent-log noise — the implementer would then build from nothing
  // (task 223: plan.md was 301 chars of "[System: thinking_tokens]"). The
  // reuse-check above only fires for the phase that PRODUCES an md; the
  // implementer CONSUMES plan.md without re-validating it. So before the
  // implementer runs, re-validate plan.md and roll the workflow back to draft
  // when it is unusable — the researcher/planner reuse-checks then regenerate
  // ONLY the polluted artifacts (a clean one is skipped) before re-implementing.
  // Lightweight mode has NO plan phase, so the implementer legitimately runs
  // with no plan.md — skip the plan-validity guard. Otherwise an empty/absent
  // plan.md reads as "broken plan" and rolls a lightweight task back to re-plan
  // forever (task 229's plan_invalid_replan loop, and why the lightweight
  // research→implement handoff stalled at research_done).
  if (transition.role === 'implementer' && workflowMode !== 'lightweight') {
    const planMd = await readWorkflowFile(taskId, 'plan').catch(() => null);
    if (!planMd || !isReusableArtifact('plan', planMd)) {
      // BOUND the replan loop. Previously this rolled back to draft every time
      // an invalid plan.md was seen, with no limit and WITHOUT removing the bad
      // file — so a plan that kept coming back invalid spun forever
      // (draft→…→plan_approved→rollback, ~1/s, hitting maxIterations then
      // retrying). Count prior replans; once exhausted, block for inspection
      // instead of looping.
      // Window to "recent" so old replans from an unrelated past run don't
      // pre-block a fresh re-run; a real loop trips this within seconds.
      const priorReplans = await countWithFailClosed(
        prisma.workflowTransition.count({
          where: {
            taskId,
            cause: 'plan_invalid_replan',
            createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) },
          },
        }),
        MAX_PLAN_REPLANS,
        log,
        { taskId },
        'plan-replan',
      );

      if (priorReplans >= MAX_PLAN_REPLANS) {
        log.warn(
          { taskId, priorReplans },
          '[WorkflowOrchestrator] plan.md still invalid after repeated re-plans — blocking instead of looping',
        );
        // Durable block write: this is the write that actually STOPS the
        // plan-invalid-replan loop (downstream schedulers/UI key off
        // status==='blocked' to stop re-dispatching). Swallowing a failure here
        // silently let the loop re-enter on the very next poll. Retry once, and
        // if it still fails, escalate via a Notification so a human intervenes
        // instead of the loop silently repeating.
        await writeBlockedStatusDurable({
          taskId,
          log,
          source: 'WorkflowOrchestrator',
          notification: {
            title: 'ブロック処理の書き込みに失敗',
            message: `タスク #${taskId} を blocked にする更新が2回失敗しました。再計画ループが再発する可能性があるため手動確認が必要です。`,
          },
        });
        await recordTransition({
          taskId,
          fromStatus: 'plan_approved',
          toStatus: 'plan_approved',
          actor: 'system',
          cause: 'plan_invalid_replan_exhausted',
          phase: 'plan',
          metadata: { priorReplans },
          invariantViolation: true,
          invariantMessage:
            'plan.md remained invalid after repeated re-plans; blocked to stop the loop',
        }).catch(() => {});
        import('../communication/notification-service')
          .then(({ createNotification }) =>
            createNotification({
              type: 'system',
              title: '計画の再生成に失敗（ブロック）',
              message: `タスク #${taskId} は plan.md が繰り返し不正なため、再計画を打ち切りブロックしました。手動で確認してください。`,
              link: `/tasks?taskId=${taskId}`,
              metadata: { taskId, priorReplans, reason: 'plan_invalid_replan_exhausted' },
            }),
          )
          .catch(() => {});
        const result: WorkflowAdvanceResult = {
          success: false,
          role: transition.role,
          status: 'plan_approved' as WorkflowStatus,
          error: 'plan.md が繰り返し不正なため再計画を打ち切りブロックしました',
        };
        return { done: true as const, result };
      }

      log.warn(
        `[WorkflowOrchestrator] task ${taskId}: plan.md is log-polluted or non-substantive — archiving it and rolling back to re-plan (attempt ${priorReplans + 1}/${MAX_PLAN_REPLANS})`,
      );
      // Archive the bad plan so the planner MUST regenerate it (it can no
      // longer be reused by the reuse-check), breaking the reuse↔reject loop.
      await archiveWorkflowFile(taskId, 'plan').catch(() => {});
      await prisma.task.update({
        where: { id: taskId },
        data: { workflowStatus: 'draft' },
      });
      await recordTransition({
        taskId,
        fromStatus: 'plan_approved',
        toStatus: 'draft',
        actor: 'system',
        cause: 'plan_invalid_replan',
        phase: 'plan',
        metadata: {
          reason: 'plan.md is log-polluted or non-substantive; archived + regenerating',
        },
      }).catch(() => {});
      // Re-dispatch the regeneration ourselves: when this rollback was reached
      // via a one-shot advance (plan auto-approve / UI "進行"), nothing else
      // will ever advance the task again (task 546 sat 40 min at draft).
      // Duplicate-safe — a live queue loop's next advance just wins the
      // per-task execution lock and this one returns skipped.
      scheduleWorkflowRedispatch(taskId, 'plan_invalid_replan', language);
      const result: WorkflowAdvanceResult = {
        success: true,
        role: transition.role,
        status: 'draft',
        output: 'plan.md が壊れている（ログ汚染/空）ため、退避して再計画にロールバックしました',
      };
      return { done: true as const, result };
    }
  }

  return { done: false as const };
}
