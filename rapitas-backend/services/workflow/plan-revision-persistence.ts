import type { PrismaClient } from '../../generated/prisma-postgres';
import { PLAN_REVISION_CAUSE } from './workflow-plan-revision-context';

/** Input to {@link persistPlanRevisionCore}. */
export interface PersistPlanRevisionCoreParams {
  taskId: number;
  /** CAS guard: the task row's `updatedAt` the caller last observed. / CAS対象のupdatedAt */
  expectedUpdatedAt: Date;
  /** CAS guard: the task row's `workflowStatus` the caller last observed. / CAS対象のworkflowStatus */
  expectedWorkflowStatus: string | null;
  instruction: string;
  source: string;
}

/**
 * CAS-guarded core of a plan revision request: rolls the task back to
 * `research_done` and records a `plan_revision_requested` transition carrying
 * the instruction. Authorization is the caller's responsibility — this never
 * inspects who is calling (the `X-Rapitas-Source` header guard lives only in
 * {@link handleRevisePlan}'s HTTP layer; the question-answer routing path
 * (task 933) has its own separate justification for calling this directly).
 *
 * @param db - Prisma client (transaction-capable). / DBクライアント
 * @param params - CAS snapshot + instruction/source to record. / CAS情報と記録内容
 * @throws Whatever `db.$transaction` throws, including a 0-row CAS update
 *   when `task.id`/`updatedAt`/`workflowStatus` no longer match. Callers
 *   decide how to react — the HTTP handler propagates it, the question-answer
 *   flow falls back to its normal resume routing.
 */
export async function persistPlanRevisionCore(
  db: PrismaClient,
  params: PersistPlanRevisionCoreParams,
): Promise<void> {
  const { taskId, expectedUpdatedAt, expectedWorkflowStatus, instruction, source } = params;
  // The instruction is execution input, not best-effort telemetry. Persist it
  // with the rollback state, or leave both unchanged. Reject stale requests.
  await db.$transaction(async (tx) => {
    await tx.task.update({
      where: { id: taskId, updatedAt: expectedUpdatedAt, workflowStatus: expectedWorkflowStatus },
      data: { workflowStatus: 'research_done', status: 'in-progress', updatedAt: new Date() },
      select: { id: true },
    });
    await tx.workflowTransition.create({
      data: {
        taskId,
        fromStatus: expectedWorkflowStatus,
        toStatus: 'research_done',
        actor: 'user',
        cause: PLAN_REVISION_CAUSE,
        phase: 'plan',
        metadata: JSON.stringify({ instruction, source }),
      },
    });
  });
}

/**
 * `POST /workflow/tasks/:taskId/revise-plan` entry point — thin wrapper over
 * {@link persistPlanRevisionCore} using the task snapshot as the CAS baseline.
 *
 * @param db - Prisma client (transaction-capable). / DBクライアント
 * @param task - Task snapshot to use as the CAS baseline. / CASの基準スナップショット
 * @param instruction - The human's revision instruction. / 修正指示
 * @param source - Label recorded in the transition metadata. / 記録するsource
 */
export async function persistPlanRevision(
  db: PrismaClient,
  task: { id: number; updatedAt: Date; workflowStatus: string | null },
  instruction: string,
  source: string,
): Promise<void> {
  await persistPlanRevisionCore(db, {
    taskId: task.id,
    expectedUpdatedAt: task.updatedAt,
    expectedWorkflowStatus: task.workflowStatus,
    instruction,
    source,
  });
}

/**
 * Map a question-answer flow `sourceLabel` (e.g. 'ユーザー選択',
 * 'オペレーター代理回答', or the auto-answer heal pass's
 * '推奨案の自動採用（無応答タイムアウト）') to the vocabulary
 * {@link handleRevisePlan}'s `REVISION_SOURCE_LABELS` already uses
 * ('ユーザー'/'オペレーター'), plus a third bucket for the unattended
 * timeout auto-adopt path, so `getPendingPlanRevision`'s readers see one
 * consistent vocabulary regardless of which flow recorded the transition.
 *
 * @param sourceLabel - The question-answer flow's source label. / 回答元ラベル
 * @returns The unified `metadata.source` value. / 統一後のsource値
 */
export function mapAnswerSourceLabelToRevisionSource(sourceLabel: string): string {
  if (sourceLabel === 'オペレーター代理回答') return 'オペレーター';
  if (sourceLabel.includes('自動採用')) return 'システム（自動採用）';
  return 'ユーザー';
}
