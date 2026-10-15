/** A durable answer starts a new run budget; heartbeats do not reset its hard ceiling. */
import type { PrismaClient } from '../../../generated/prisma-postgres';

export async function resolveResumedTenureStart(
  prisma: PrismaClient,
  taskId: number,
  original: number,
): Promise<number> {
  const resume = await prisma.workflowTransition.findFirst({
    where: {
      taskId,
      fromStatus: 'awaiting_question',
      cause: { in: ['intake_question_answered', 'question_resolved'] },
      createdAt: { gt: new Date(original) },
    },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  const resumedAt = resume?.createdAt.getTime();
  return resumedAt !== undefined && Number.isFinite(resumedAt)
    ? Math.max(original, resumedAt)
    : original;
}

/**
 * Clamp the tenure start to when auto-run itself last started.
 *
 * `lastRunAt` records when the task became current, and the hang backstop
 * measures from it — but a theme that is paused keeps `lastRunAt` frozen while
 * the scheduler does nothing. The pause therefore accrues tenure the task could
 * not possibly have spent working, and any pause longer than MAX_TASK_WALL_MS
 * guarantees a hang backstop on the very next tick after resuming.
 *
 * Measured 2026-10-06: theme 1 was paused at 07:31 UTC with task 1116 current,
 * resumed at 10:35:53, and the backstop fired at 10:36:06 — 13 seconds later,
 * reporting wallMinutes 45. The task was fine and completed as PR 836. This is
 * the same defect the iteration budget's TIME axis already fixed for #911
 * (task-iteration-budget-active-clock.ts): wall time a task spends unable to
 * progress is not time spent iterating.
 *
 * Only ever moves the start FORWARD, so it can never extend a tenure.
 *
 * @param prisma - Client / Prisma クライアント
 * @param themeId - Theme whose auto-run row holds startedAt / 対象テーマ
 * @param original - Tenure start resolved so far (ms) / これまでに解決した起点
 * @returns The later of `original` and auto-run's startedAt (ms) / 遅い方の起点
 */
export async function resolveAutoRunRestartTenureStart(
  prisma: PrismaClient,
  themeId: number,
  original: number,
): Promise<number> {
  let startedAt: number | undefined;
  try {
    const row = await prisma.themeAutoRun.findUnique({
      where: { themeId },
      select: { startedAt: true },
    });
    startedAt = row?.startedAt?.getTime();
  } catch {
    // try/catch rather than .catch(): an absent `themeAutoRun` model throws
    // SYNCHRONOUSLY on the property access, which a promise .catch() cannot
    // see. That is the shape every scheduler test's partial prisma mock has.
    return original;
  }
  // No row or no startedAt means we cannot prove a restart — leave the tenure
  // alone rather than silently exempting the task from the backstop.
  return startedAt !== undefined && Number.isFinite(startedAt)
    ? Math.max(original, startedAt)
    : original;
}
