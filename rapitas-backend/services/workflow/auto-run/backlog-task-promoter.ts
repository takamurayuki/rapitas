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

const log = createLogger('auto-run:backlog-promoter');

/** Outstanding (todo / in-progress) auto-created tasks for a theme. */
async function countOutstandingAutoCreated(themeId: number): Promise<number> {
  return prisma.task
    .count({
      where: {
        themeId,
        autoCreatedFromBacklog: true,
        status: { in: ['todo', 'in-progress'] },
      },
    })
    .catch(() => 0);
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
