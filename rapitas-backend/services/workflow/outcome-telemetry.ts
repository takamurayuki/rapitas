/**
 * Outcome Telemetry
 *
 * Closes the autonomy loop: records a structured "task outcome" when a task ends
 * (completed/blocked) and derives a per-theme difficulty signal from recent
 * outcomes. The orchestrator feeds that signal into routing so themes whose tasks
 * have been failing/repair-heavy get a stronger model tier — measure, then adapt.
 * Not responsible for model selection itself (see routing-policy / smart-router).
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { appendEvent } from '../memory/timeline';

const log = createLogger('workflow:outcome-telemetry');

/** WorkflowTransition causes that signal the task hit trouble (needed repair/blocked). */
const TROUBLE_CAUSES = [
  'verify_repair',
  'ci_repair',
  'adversarial_review_failed',
  'verify_validation_failed',
  'verify_no_changes',
  'verify_pr_not_created',
  'auto_merge_blocked',
  'log_polluted_rejected',
];

/** How many recent terminal tasks to consider for the per-theme difficulty. */
const RECENT_WINDOW = 10;
/** Need at least this many samples before adapting (avoid noise). */
const MIN_SAMPLES = 3;

/**
 * Record a task's outcome as a timeline event (observability + future learning).
 * Best-effort — never throws into the caller.
 *
 * @param taskId - The task that ended. / 終了したタスク
 * @param finalStatus - 'completed' | 'blocked' (or other terminal). / 最終状態
 */
export async function recordTaskOutcome(taskId: number, finalStatus: string): Promise<void> {
  try {
    const task = await prisma.task
      .findUnique({
        where: { id: taskId },
        select: { themeId: true, workflowMode: true, complexityScore: true },
      })
      .catch(() => null);

    const troubleCount = await prisma.workflowTransition
      .count({ where: { taskId, cause: { in: TROUBLE_CAUSES } } })
      .catch(() => 0);

    const exec = await prisma.agentExecution
      .findFirst({
        where: { session: { config: { taskId } } },
        orderBy: { createdAt: 'desc' },
        select: { modelName: true },
      })
      .catch(() => null);

    const firstTrySuccess = finalStatus === 'completed' && troubleCount === 0;

    await appendEvent({
      eventType: 'task_outcome',
      actorType: 'system',
      payload: {
        taskId,
        themeId: task?.themeId ?? null,
        finalStatus,
        firstTrySuccess,
        troubleCount,
        workflowMode: task?.workflowMode ?? null,
        complexityScore: task?.complexityScore ?? null,
        model: exec?.modelName ?? null,
      },
      correlationId: `task_${taskId}`,
    });
    log.info(
      { taskId, finalStatus, firstTrySuccess, troubleCount },
      '[telemetry] Task outcome recorded',
    );

    // Outcome-gated reinforcement: reward the knowledge entries this task used
    // when it completed, decay them when it was blocked — so what survives the
    // forgetting curve is what actually helped. Best-effort, never blocks.
    await import('../memory/outcome-reinforcement')
      .then(({ applyOutcomeReinforcement }) =>
        applyOutcomeReinforcement(taskId, finalStatus === 'completed'),
      )
      .catch((err) => log.warn({ err, taskId }, '[telemetry] Outcome reinforcement failed'));
  } catch (err) {
    log.warn({ err, taskId }, '[telemetry] Failed to record task outcome');
  }
}

/**
 * Derive an escalation level (0/1/2) for a theme from its recent terminal tasks:
 * the fraction that were "troubled" (ended blocked OR needed a repair). A high
 * trouble rate raises the model tier for that theme's next tasks via
 * computeMinTier's `escalation` input. Returns 0 when there is not enough data.
 *
 * @param themeId - Theme to assess (null → no signal). / 対象テーマ
 * @returns Escalation level 0-2. / エスカレーションレベル
 */
export async function recentThemeEscalation(themeId: number | null | undefined): Promise<number> {
  if (themeId == null) return 0;
  try {
    const recent = await prisma.task.findMany({
      where: { parentId: null, themeId, status: { in: ['done', 'completed', 'blocked'] } },
      orderBy: [{ completedAt: 'desc' }, { updatedAt: 'desc' }],
      take: RECENT_WINDOW,
      select: { id: true, status: true },
    });
    if (recent.length < MIN_SAMPLES) return 0;

    const ids = recent.map((t) => t.id);
    const troubledRows = await prisma.workflowTransition
      .findMany({
        where: { taskId: { in: ids }, cause: { in: TROUBLE_CAUSES } },
        select: { taskId: true },
        distinct: ['taskId'],
      })
      .catch(() => [] as Array<{ taskId: number }>);
    const troubled = new Set(troubledRows.map((r) => r.taskId));
    for (const t of recent) if (t.status === 'blocked') troubled.add(t.id);

    const rate = troubled.size / recent.length;
    const escalation = rate >= 0.5 ? 2 : rate >= 0.25 ? 1 : 0;
    if (escalation > 0) {
      log.info(
        { themeId, samples: recent.length, troubled: troubled.size, rate, escalation },
        '[telemetry] Theme difficulty → routing escalation',
      );
    }
    return escalation;
  } catch (err) {
    log.warn({ err, themeId }, '[telemetry] recentThemeEscalation failed — no escalation');
    return 0;
  }
}
