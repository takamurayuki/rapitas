/**
 * review-cost-record
 *
 * Records what one adversarial diff review spent: one AgentExecution per
 * juror call that answered, under the task's newest AgentSession, so task
 * budgets, the iteration budget, monthly usage and repair-cycle cost pick the
 * review up without changes of their own. Not responsible for the verdict.
 *
 * NOTE: These rows are told apart by `command = REVIEW_COST_COMMAND`; every
 * "latest execution of the task" read excludes them (review-cost-rows.ts).
 */
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { REVIEW_COST_COMMAND } from '../review-cost-rows';
import { recomputeSessionTotals, type SessionTotalsDb } from '../session-cost-totals';
import type { JurorVerdict, PanelVerdict } from './adversarial-diff-review-verdict';

const log = createLogger('verification:review-cost-record');

/**
 * Persist the panel's spend. Never throws; returns how many rows it wrote.
 *
 * @param params.taskId - Reviewed task / 対象タスク
 * @param params.jurors - Juror verdicts with their usage / 利用量つきの陪審判定
 * @param params.verdict - Aggregated verdict, stored in each row's output / 集計判定
 * @returns Rows written (0 when there is no session or nothing answered) / 書き込んだ行数
 */
export async function recordReviewCost(params: {
  taskId: number;
  jurors: JurorVerdict[];
  verdict: PanelVerdict;
}): Promise<number> {
  const answered = params.jurors.filter((j) => j.usage);
  if (answered.length === 0) return 0;
  try {
    const session = await prisma.agentSession.findFirst({
      where: { config: { taskId: params.taskId } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!session) return 0;
    for (const j of answered) {
      const u = j.usage!;
      await prisma.agentExecution.create({
        data: {
          sessionId: session.id,
          command: REVIEW_COST_COMMAND,
          status: 'completed',
          output: JSON.stringify({
            kind: REVIEW_COST_COMMAND,
            juror: `${j.provider}:${j.model ?? ''}`,
            // Seat (role) the call was made in — reviewer-1 / reviewer-2 / verifier.
            seatId: (j as { seatId?: string }).seatId,
            jurorVerdict: j.verdict,
            panelVerdict: params.verdict,
            findings: j.findings?.length ?? 0,
          }),
          startedAt: u.startedAt,
          completedAt: new Date(u.startedAt.getTime() + u.durationMs),
          executionTimeMs: u.durationMs,
          tokensUsed: u.tokensUsed,
          inputTokens: u.inputTokens ?? 0,
          outputTokens: u.outputTokens ?? 0,
          cacheReadInputTokens: u.cacheReadInputTokens ?? 0,
          cacheCreationInputTokens: u.cacheCreationInputTokens ?? 0,
          costUsd: u.costUsd ?? 0,
          modelName: u.modelName ?? j.model ?? j.provider,
          llmCallCount: 1,
        },
      });
    }
    await recomputeSessionTotals(prisma as unknown as SessionTotalsDb, session.id);
    return answered.length;
  } catch (err) {
    log.warn({ err, taskId: params.taskId }, '[review-cost] Failed to record review cost');
    return 0;
  }
}
