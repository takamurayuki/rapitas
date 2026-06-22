/**
 * backlog-task-promoter
 *
 * When a theme's auto-run runs out of work, refill it from the backlog so the
 * loop keeps making progress instead of going idle: promote OPEN concerns into
 * tasks first (higher priority), and only once the concern backlog is clear,
 * promote ideas from the idea box. Bounded by the per-theme
 * UserSettings.autoCreateFromBacklogLimit (counted against the theme's
 * outstanding auto-created tasks). NOT responsible for selecting/executing the
 * created tasks — the scheduler re-selects after this returns.
 */
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { listConcerns, convertConcernToTask } from '../../memory/concern-backlog-service';
import { listIdeas, markIdeaAsUsed } from '../../memory/idea-box-service';
import { createTask } from '../../task/task-mutations';
import { logCycleEvent } from '../../observability';

const log = createLogger('auto-run:backlog-promoter');

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
 */
async function countOutstandingAutoCreated(themeId: number): Promise<number> {
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
 * Whether a promotion would create at least one task right now: the cap has room
 * (outstanding < limit) AND there is an open concern or idea to promote. Used to
 * decide whether to auto-resume an idle theme — no side effects (does not create).
 *
 * @param themeId - Theme to check. / 対象テーマID
 * @returns true when promotion would yield a task. / 起票が発生する見込みなら true
 */
export async function hasPromotableBacklog(themeId: number): Promise<boolean> {
  const limit = await resolveLimit();
  if (limit <= 0) return false;
  const outstanding = await countOutstandingAutoCreated(themeId);
  if (outstanding >= limit) return false;
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

/** Read the global per-theme backlog promotion cap (0 = disabled). */
async function resolveLimit(): Promise<number> {
  const s = await prisma.userSettings
    .findFirst({ select: { autoCreateFromBacklogLimit: true } })
    .catch(() => null);
  return Math.max(0, s?.autoCreateFromBacklogLimit ?? 0);
}

/** Mark a freshly created task as backlog-promoted (best-effort). */
async function markAutoCreated(taskId: number): Promise<void> {
  await prisma.task
    .update({ where: { id: taskId }, data: { autoCreatedFromBacklog: true } })
    .catch((err) => log.warn({ err, taskId }, '[backlog-promoter] Failed to mark autoCreated'));
}

/**
 * Promote backlog items into tasks for a theme that has run out of work.
 *
 * Concern backlog takes priority over the idea box: ideas are only promoted once
 * NO open concerns remain (the concern backlog is fully cleared). Both are taken
 * highest-priority first (the list services order by severity/priority weight).
 *
 * @param themeId - Theme whose auto-run ran dry. / タスク切れになったテーマID
 * @returns Number of tasks created (0 when disabled or already at the cap). / 起票した件数
 */
export async function promoteBacklogForTheme(themeId: number): Promise<number> {
  const limit = await resolveLimit();
  if (limit <= 0) return 0;

  const outstanding = await countOutstandingAutoCreated(themeId);
  let remaining = limit - outstanding;
  if (remaining <= 0) return 0;

  let created = 0;

  // 1) Drain OPEN concerns first (highest severity first).
  const { concerns, total: openConcernTotal } = await listConcerns({
    status: 'open',
    themeId,
    limit: remaining,
  }).catch(() => ({ concerns: [], total: 0 }));
  for (const concern of concerns) {
    if (remaining <= 0) break;
    try {
      const taskId = await convertConcernToTask(concern.id);
      if (taskId) {
        await markAutoCreated(taskId);
        created += 1;
        remaining -= 1;
        log.info(
          { themeId, concernId: concern.id, taskId, severity: concern.severity },
          '[backlog-promoter] Promoted concern to task',
        );
        logCycleEvent('backlog.promoted', {
          theme: themeId,
          task: taskId,
          kind: 'concern',
          concernId: concern.id,
          severity: concern.severity,
          msg: 'concern promoted to task (起票)',
        });
      }
    } catch (err) {
      log.warn(
        { err, themeId, concernId: concern.id },
        '[backlog-promoter] Concern promote failed',
      );
    }
  }

  // 2) Ideas ONLY when the concern backlog is fully clear — i.e. there were zero
  // OPEN concerns this round (total counts matches before the limit is applied).
  if (remaining > 0 && openConcernTotal === 0) {
    const { ideas } = await listIdeas({ status: 'open', themeId, limit: remaining }).catch(() => ({
      ideas: [],
      total: 0,
    }));
    for (const idea of ideas) {
      if (remaining <= 0) break;
      try {
        const description = [
          idea.content,
          '',
          `アイデアボックスから自動起票 (idea #${idea.id})`,
        ].join('\n');
        const task = await createTask(prisma, {
          title: `[Idea] ${idea.title}`.slice(0, 200),
          description,
          priority: idea.priority,
          status: 'todo',
          themeId: idea.themeId ?? themeId,
        });
        if (task) {
          await markAutoCreated(task.id);
          await markIdeaAsUsed(idea.id, task.id).catch(() => {});
          created += 1;
          remaining -= 1;
          log.info(
            { themeId, ideaId: idea.id, taskId: task.id, priority: idea.priority },
            '[backlog-promoter] Promoted idea to task',
          );
          logCycleEvent('backlog.promoted', {
            theme: themeId,
            task: task.id,
            kind: 'idea',
            ideaId: idea.id,
            priority: idea.priority,
            msg: 'idea promoted to task (起票)',
          });
        }
      } catch (err) {
        log.warn({ err, themeId, ideaId: idea.id }, '[backlog-promoter] Idea promote failed');
      }
    }
  }

  if (created > 0) {
    log.info(
      { themeId, created, limit, outstanding },
      '[backlog-promoter] Refilled theme from backlog',
    );
  }
  return created;
}
