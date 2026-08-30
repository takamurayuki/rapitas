/**
 * backlog-promoter-execute
 *
 * Executes backlog promotion: converts open concerns/ideas into tasks via the
 * realized-reward bandit split, capped by the per-theme outstanding-created
 * count. Split out of backlog-task-promoter.ts (task 784) to stay under the
 * file-size ratchet; backlog-task-promoter.ts re-exports this as a barrel.
 * NOT responsible for deciding WHETHER/WHEN to refill (nightly window, idle
 * timer) — callers gate that via auto-run-idle-timer.ts's
 * shouldRefillBacklogNow / attemptCriticalConcernBypass before calling in.
 */
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import {
  listConcerns,
  convertConcernToTask,
  getConcern,
  markConcernResolved,
} from '../../memory/concern-backlog-service';
import { isLogConcernStillRecurring, fragmentFromLogConcernTitle } from './log-concern-recurrence';
import { isSelfDetectConcernStillRelevant } from './self-detect-relevance';
import { listIdeas, markIdeaAsUsed } from '../../memory/idea-box-service';
import { createTask } from '../../task/task-mutations';
import { logCycleEvent } from '../../observability';
import {
  selectBacklogArm,
  getBacklogArmStats,
  CRITICAL_CONCERN_SEVERITIES,
} from './backlog-bandit';
import { pickDiverseIdeas, getRecentIdeaTaskTitles } from './idea-promotion-diversity';
import { resolveLimit, countOutstandingAutoCreated } from './backlog-promoter-eligibility';

const log = createLogger('auto-run:backlog-promoter');

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

/**
 * Promote one concern into a task; returns true when a task was created.
 * Exported so auto-run-idle-timer.ts's attemptCriticalConcernBypass (task
 * 784) can reuse the same promotion path for the severity-bypass case.
 *
 * @param themeId - Theme the concern belongs to. / 対象テーマID
 * @param concern - Concern to promote. / 起票する懸念
 * @returns true when a task was created. / 起票されたら true
 */
export async function promoteConcern(
  themeId: number,
  concern: { id: number; severity: string; title?: string },
): Promise<boolean> {
  try {
    // A log-derived concern whose signature has gone quiet is an outage that
    // already ended: promoting it buys three agent phases to conclude 修正不要
    // (five such tasks on 2026-08-30 for one resolved Prisma mismatch).
    // Retire it here; anything still recurring is promoted as before.
    const full = await getConcern(concern.id).catch(() => null);
    // Concerns filed before the source column exist as 'unknown'; their
    // `[ログ:LEVEL]` title is the reliable mark (concern #4792 from 08-05 slipped
    // past a source-only check and became task #756 on the first live cycle).
    const logDerived =
      full != null &&
      (full.source === 'log_health' || fragmentFromLogConcernTitle(full.title) !== null);
    if (full && logDerived) {
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
    // Same idea for [自己検出] alarms (状態不整合 / 反復ループ): they alarm on a
    // live condition, and 25 of the week's 31 no-change completions were such
    // filings whose condition had already healed. [回顧] diagnostics are
    // deliberately NOT gated (#768 produced real follow-up work).
    if (full) {
      const relevant = await isSelfDetectConcernStillRelevant(full);
      if (relevant === false) {
        await markConcernResolved(concern.id, true);
        log.info(
          { themeId, concernId: concern.id, title: full.title.slice(0, 80) },
          '[backlog-promoter] Self-detect alarm no longer holds — resolved without a task',
        );
        logCycleEvent('backlog.concern_stale_resolved', {
          theme: themeId,
          kind: 'concern',
          concernId: concern.id,
          msg: 'self-detect alarm condition already healed; resolved instead of promoted',
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
 * NOT gated by the nightly self-refill window here (task 784) — callers
 * (auto-run-advance-select.ts, auto-run-lifecycle.ts) evaluate
 * shouldRefillBacklogNow/attemptCriticalConcernBypass themselves before
 * calling this, and stamp markSelfRefillSucceeded on success.
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
