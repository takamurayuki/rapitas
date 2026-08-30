/**
 * backlog-promoter-eligibility
 *
 * Whether a theme's backlog would yield a task if promoted right now — the
 * per-theme outstanding-auto-created cap plus the nightly self-refill gate
 * (task 784, shouldRefillBacklogNow). Read-only, no side effects. Split out
 * of backlog-task-promoter.ts to stay under the file-size ratchet;
 * backlog-task-promoter.ts re-exports this as a barrel. See
 * backlog-promoter-execute.ts for the promotion itself.
 */
import { prisma } from '../../../config/database';
import { listConcerns } from '../../memory/concern-backlog-service';
import { listIdeas } from '../../memory/idea-box-service';
import { shouldRefillBacklogNow } from './auto-run-idle-timer';

/** Blocked tasks older than this stop counting toward the cap (anti-deadlock). */
const STALE_BLOCKED_MS = 2 * 60 * 60 * 1000;

/**
 * In-flight auto-created tasks for a theme: todo / in-progress, plus RECENTLY
 * blocked tasks. Recent blocks still count so the cap pauses creation while a
 * theme's tasks are actively failing (don't flood it). But STALE blocked tasks
 * (e.g. a batch stuck by a since-fixed bug) must release their slot — otherwise a
 * pile of permanently-blocked tasks DEADLOCKS all new 起票 (observed: 10 verify-
 * gate false-positives filled the cap and stopped promotion entirely). This is
 * safe against the "create → block → create …" refill the old code feared: the
 * per-item dedup (convertConcernToTask marks the source 'task_created', so it
 * leaves the open list) already prevents re-promoting a blocked item.
 *
 * Exported (task 784) so auto-run-idle-timer.ts's attemptCriticalConcernBypass
 * can reuse the same cap check for the severity-bypass promotion path.
 *
 * @param themeId - Theme to count for. / 対象テーマID
 * @returns Outstanding auto-created task count. / 未処理の自動起票数
 */
export async function countOutstandingAutoCreated(themeId: number): Promise<number> {
  const staleCutoff = new Date(Date.now() - STALE_BLOCKED_MS);
  return prisma.task
    .count({
      where: {
        themeId,
        autoCreatedFromBacklog: true,
        OR: [
          { status: { in: ['todo', 'in-progress'] } },
          { status: 'blocked', updatedAt: { gt: staleCutoff } },
        ],
      },
    })
    .catch(() => 0);
}

/**
 * Read the global per-theme backlog promotion cap (0 = disabled). Exported
 * (task 784) so auto-run-idle-timer.ts's attemptCriticalConcernBypass can
 * reuse the same cap check for the severity-bypass promotion path.
 *
 * @returns Cap value; 0 means promotion is disabled. / 上限値（0で無効）
 */
export async function resolveLimit(): Promise<number> {
  const s = await prisma.userSettings
    .findFirst({ select: { autoCreateFromBacklogLimit: true } })
    .catch(() => null);
  return Math.max(0, s?.autoCreateFromBacklogLimit ?? 0);
}

/**
 * Whether a promotion would create at least one task right now: the cap has room
 * (outstanding < limit), the nightly self-refill gate allows it (task 784), AND
 * there is an open concern or idea to promote. Used to decide whether to
 * auto-resume an idle theme — no side effects (does not create).
 *
 * @param themeId - Theme to check. / 対象テーマID
 * @param now - Decision time (injectable for tests). / 判定時刻
 * @returns true when promotion would yield a task. / 起票が発生する見込みなら true
 */
export async function hasPromotableBacklog(
  themeId: number,
  now: Date = new Date(),
): Promise<boolean> {
  const limit = await resolveLimit();
  if (limit <= 0) return false;
  const outstanding = await countOutstandingAutoCreated(themeId);
  if (outstanding >= limit) return false;
  if (!(await shouldRefillBacklogNow(themeId, now))) return false;
  const { total: concernTotal } = await listConcerns({ status: 'open', themeId, limit: 1 }).catch(
    () => ({ concerns: [], total: 0 }),
  );
  if (concernTotal > 0) return true;
  const { total: ideaTotal } = await listIdeas({ status: 'open', themeId, limit: 1 }).catch(() => ({
    ideas: [],
    total: 0,
  }));
  return ideaTotal > 0;
}
