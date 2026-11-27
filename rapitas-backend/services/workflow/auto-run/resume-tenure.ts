/** A durable answer starts a new run budget; heartbeats do not reset its hard ceiling. */
import type { PrismaClient } from '../../../generated/prisma-postgres';
import { NOT_REVIEW_COST_ROW } from '../../agents/review-cost-rows';

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

/** Transition causes that mean the task was sent back to implement or its question answered. */
const PROGRESS_CAUSES = ['verify_repair', 'question_resolved'];

/**
 * Move the tenure start to the last time the task actually moved forward.
 *
 * The absolute ceiling (3x the wall) used to be measured from when the theme
 * selected the task, so a large task that bounced through answers and repairs
 * was stopped at 135 minutes even with a live execution (1562's 13-minute-old
 * verifier on 2026-11-26; 1542 and 1551 the same way). The signals are fixed to
 * a `verify_repair` / `question_resolved` transition and the newest
 * AgentExecution start; nothing else (heartbeats included) moves the start.
 * Only ever moves it FORWARD, and each lookup fails open independently.
 *
 * @param prisma - Client / Prisma クライアント
 * @param taskId - Task being measured / 対象タスク
 * @param original - Tenure start resolved so far (ms) / これまでに解決した起点
 * @returns The latest of `original` and the progress signals (ms) / 最も遅い起点
 */
export async function resolveProgressTenureStart(
  prisma: PrismaClient,
  taskId: number,
  original: number,
): Promise<number> {
  let latest = original;
  const take = (at: Date | null | undefined) => {
    const ms = at?.getTime();
    if (ms !== undefined && Number.isFinite(ms)) latest = Math.max(latest, ms);
  };
  try {
    const bounce = await prisma.workflowTransition.findFirst({
      where: { taskId, cause: { in: PROGRESS_CAUSES }, createdAt: { gt: new Date(original) } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    take(bounce?.createdAt);
  } catch {
    // an absent model throws synchronously in partial test mocks; keep the other signal
  }
  try {
    const run = await prisma.agentExecution.findFirst({
      where: {
        ...NOT_REVIEW_COST_ROW,
        session: { config: { taskId } },
        startedAt: { gt: new Date(original) },
      },
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true },
    });
    take(run?.startedAt);
  } catch {
    // fail open: the original start stands
  }
  return latest;
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
    const row = await prisma.themeAutoRun.findFirst({
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

/** When this backend process started (epoch ms). */
const BACKEND_BOOT_AT = Date.now();

/**
 * When this backend process started. A tenure or progress stamp older than
 * this spans time the backend was not running.
 *
 * @returns Process start time (epoch ms) / プロセス起動時刻
 */
export function backendBootAt(): number {
  return BACKEND_BOOT_AT;
}

/**
 * Move a start that predates the backend boot up to the boot, so time the
 * backend was down is never measured as a hang.
 *
 * NOTE: On 2026-11-23 the backend was down ~6 h (a ghost socket held port
 * 3001). TempoRaid task 1307's last progress predated the outage, so the first
 * tick after the restart fired auto_run_hang_backstop and blocked it, and the
 * blocked auto-retry reset its finished implementation to draft. A task that
 * is truly wedged after a restart still trips the backstop one wall later.
 *
 * @param startMs - Tenure start or last-progress stamp (ms) / 起点
 * @param bootAt - Backend boot time (ms) / 起動時刻
 * @returns The later of the two (ms) / 遅い方
 */
export function clampToBackendBoot(startMs: number, bootAt: number): number {
  return Math.max(startMs, bootAt);
}
