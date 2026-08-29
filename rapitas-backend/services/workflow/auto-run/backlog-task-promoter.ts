/**
 * backlog-task-promoter
 *
 * When a theme's auto-run runs out of work, refill it from the backlog so the
 * loop keeps making progress instead of going idle. The concern-vs-idea split
 * is decided per pick by a realized-reward bandit (backlog-bandit, R6) instead
 * of the old fixed "ideas only after the concern backlog is empty" hierarchy;
 * critical concerns (severity >= 80) still always run first. Bounded by the
 * per-theme UserSettings.autoCreateFromBacklogLimit (counted against the
 * theme's outstanding auto-created tasks). NOT responsible for selecting/
 * executing the created tasks — the scheduler re-selects after this returns.
 */
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import {
  listConcerns,
  convertConcernToTask,
  getConcern,
  markConcernResolved,
} from '../../memory/concern-backlog-service';
import { isLogConcernStillRecurring } from './log-concern-recurrence';
import { listIdeas, markIdeaAsUsed } from '../../memory/idea-box-service';
import { createTask } from '../../task/task-mutations';
import { logCycleEvent } from '../../observability';
import {
  selectBacklogArm,
  getBacklogArmStats,
  CRITICAL_CONCERN_SEVERITIES,
} from './backlog-bandit';
import { pickDiverseIdeas, getRecentIdeaTaskTitles } from './idea-promotion-diversity';

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
 * Record the filing in the decision ledger — what was promoted and what it is
 * expected to achieve — so the promotion can later be shown to have been worth
 * making. Never blocks the promotion it describes.
 */
async function recordFiling(decision: {
  taskId: number;
  source: 'concern' | 'idea';
  sourceId: number;
  title: string;
  basis: string;
  expectation: string;
}): Promise<void> {
  await import('../../decision-ledger')
    .then(({ recordFilingDecision }) => recordFilingDecision(decision))
    .catch(() => {});
}

/** Promote one concern; returns true when a task was created. */
async function promoteConcern(
  themeId: number,
  concern: { id: number; severity: string; title?: string },
): Promise<boolean> {
  try {
    // A log-derived concern whose signature has gone quiet is an outage that
    // already ended: promoting it buys three agent phases to conclude 修正不要
    // (five such tasks on 2026-08-30 for one resolved Prisma mismatch).
    // Retire it here; anything still recurring is promoted as before.
    const full = await getConcern(concern.id).catch(() => null);
    if (full?.source === 'log_health') {
      const recurring = await isLogConcernStillRecurring(full);
      if (recurring === false) {
        await markConcernResolved(concern.id, true);
        log.info(
          { themeId, concernId: concern.id, title: full.title.slice(0, 80) },
          '[backlog-promoter] Log concern has not recurred in 24h — resolved without a task',
        );
        logCycleEvent('backlog.concern_stale_resolved', {
          theme: themeId,
          kind: 'concern',
          concernId: concern.id,
          msg: 'log-derived concern silent for 24h; resolved instead of promoted',
        });
        return false;
      }
    }
    const taskId = await convertConcernToTask(concern.id);
    if (!taskId) return false;
    await markAutoCreated(taskId);
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
    await recordFiling({
      taskId,
      source: 'concern',
      sourceId: concern.id,
      title: concern.title ?? `concern #${concern.id}`,
      basis: `深刻度 ${concern.severity} の未解決の懸念`,
      expectation: 'この懸念が解消され、再発しない',
    });
    return true;
  } catch (err) {
    log.warn({ err, themeId, concernId: concern.id }, '[backlog-promoter] Concern promote failed');
    return false;
  }
}

/** Promote one idea; returns true when a task was created. */
async function promoteIdea(
  themeId: number,
  idea: { id: number; title: string; content: string; priority: string; themeId: number | null },
): Promise<boolean> {
  // NOTE: Uncategorized (themeless) ideas must never be auto-promoted — a human
  // hasn't decided which repo they belong to yet. The per-theme listIdeas query
  // already excludes them; this guard replaces the old `?? themeId` fallback
  // that would have silently adopted one into the current theme if any future
  // caller passed it through.
  if (idea.themeId == null) {
    log.info({ themeId, ideaId: idea.id }, '[backlog-promoter] Skipped uncategorized idea');
    return false;
  }
  try {
    const description = [idea.content, '', `アイデアボックスから自動起票 (idea #${idea.id})`].join(
      '\n',
    );
    const task = await createTask(prisma, {
      title: `[Idea] ${idea.title}`.slice(0, 200),
      description,
      priority: idea.priority,
      status: 'todo',
      themeId: idea.themeId,
    });
    if (!task) return false;
    await markAutoCreated(task.id);
    await markIdeaAsUsed(idea.id, task.id).catch(() => {});
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
    await recordFiling({
      taskId: task.id,
      source: 'idea',
      sourceId: idea.id,
      title: idea.title,
      basis: `優先度 ${idea.priority} のアイデア`,
      expectation: 'このアイデアの効果が実際に得られる',
    });
    return true;
  } catch (err) {
    log.warn({ err, themeId, ideaId: idea.id }, '[backlog-promoter] Idea promote failed');
    return false;
  }
}

/**
 * Promote backlog items into tasks for a theme that has run out of work.
 *
 * Each slot's concern-vs-idea choice comes from the realized-reward bandit
 * (UCB1 over recent promoted-task outcomes); a critical concern (severity >= 80)
 * still forces concerns first, and within an arm items stay highest-severity/
 * priority first (the list services order them).
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

  // Over-fetch ideas so the diversity pick has a real pool to choose from —
  // the open list is newest-first, and the newest ideas are typically the
  // ones extracted from the task JUST executed (the monoculture source).
  const ideaPool = Math.min(30, Math.max(remaining * 5, 15));
  // Does a CRITICAL concern exist anywhere in the open set? Asked with its own
  // query on purpose: the batch below is capped at `remaining` (often 1), and
  // the list is newest-first, so an urgent concern sitting anywhere past the
  // first page was invisible to the override that exists to jump the queue for
  // it. Measured 2026-08-27: 43 open concerns, batch size 1.
  const criticalProbe = await Promise.all(
    [...CRITICAL_CONCERN_SEVERITIES].map((severity) =>
      listConcerns({ status: 'open', themeId, severity: severity as never, limit: 1 }).catch(
        () => ({ concerns: [], total: 0 }),
      ),
    ),
  );
  const hasCriticalConcern = criticalProbe.some((r) => r.total > 0);

  const [concernList, ideaList, armStats, recentIdeaTitles] = await Promise.all([
    listConcerns({ status: 'open', themeId, limit: remaining }).catch(() => ({
      concerns: [],
      total: 0,
    })),
    listIdeas({ status: 'open', themeId, limit: ideaPool }).catch(() => ({
      ideas: [],
      total: 0,
    })),
    getBacklogArmStats(prisma, themeId),
    getRecentIdeaTaskTitles(prisma, themeId),
  ]);
  const concerns = [...concernList.concerns];
  // Diversity pick (anti-monoculture at the promotion gate): space the batch
  // away from recently promoted idea-tasks, from each other, and across QD
  // cells — otherwise one task's flavor becomes the next several tasks.
  const diverse = pickDiverseIdeas(ideaList.ideas, recentIdeaTitles, remaining);
  if (diverse.skippedAsSimilar > 0) {
    log.info(
      {
        themeId,
        pool: ideaList.ideas.length,
        picked: diverse.picked.length,
        skippedAsSimilar: diverse.skippedAsSimilar,
        fallbackUsed: diverse.fallbackUsed,
      },
      '[backlog-promoter] Idea diversity pick applied',
    );
  }
  const ideas = [...diverse.picked];

  let created = 0;
  while (remaining > 0) {
    const arm = selectBacklogArm({
      concern: armStats.concern,
      idea: armStats.idea,
      openConcerns: concerns.length,
      openIdeas: ideas.length,
      hasCriticalConcern,
    });
    if (!arm) break;

    if (arm === 'concern') {
      const concern = concerns.shift();
      if (!concern) continue;
      if (await promoteConcern(themeId, concern)) {
        created += 1;
        remaining -= 1;
      }
    } else {
      const idea = ideas.shift();
      if (!idea) continue;
      if (await promoteIdea(themeId, idea)) {
        created += 1;
        remaining -= 1;
      }
    }
  }

  if (created > 0) {
    log.info(
      { themeId, created, limit, outstanding, armStats },
      '[backlog-promoter] Refilled theme from backlog (bandit split)',
    );
  }
  return created;
}
