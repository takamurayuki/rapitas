/**
 * backlog-task-promoter
 *
 * When a theme's auto-run runs out of work, refill it from the backlog so the
 * loop keeps making progress instead of going idle. The concern-vs-idea split
 * is decided per pick by a realized-reward bandit (backlog-bandit, R6) instead
 * of the old fixed "ideas only after the concern backlog is empty" hierarchy;
 * critical concerns (severity >= 80) still always run first. Bounded by the
 * per-theme UserSettings.autoCreateFromBacklogLimit (counted against the
 * theme's outstanding auto-created tasks). Concern candidates additionally pass
 * the value gate (evidence / severity / saturation / source quota — see
 * concern-value-gate.ts); the SAME gated result feeds both hasPromotableBacklog
 * and promoteBacklogForTheme so the resume check and the actual promotion can
 * never disagree (idle⇄running flap guard). NOT responsible for selecting/
 * executing the created tasks — the scheduler re-selects after this returns.
 */
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { listConcerns, convertConcernToTask } from '../../memory/concern-backlog-service';
import type { ConcernEntry } from '../../memory/concern-backlog-service';
import { listIdeas, markIdeaAsUsed } from '../../memory/idea-box-service';
import { createTask } from '../../task/task-mutations';
import { logCycleEvent } from '../../observability';
import { findSaturatedTheme } from '../../memory/theme-saturation';
import {
  selectBacklogArm,
  getBacklogArmStats,
  CRITICAL_CONCERN_SEVERITIES,
} from './backlog-bandit';
import { pickDiverseIdeas, getRecentIdeaTaskTitles } from './idea-promotion-diversity';
import {
  evaluateConcernValueGate,
  localDayStart,
  type ValueGateRejectReason,
} from './concern-value-gate';
import { readValueGateEnabled } from './value-gate-settings-store';

const log = createLogger('auto-run:backlog-promoter');

/**
 * Open-concern fetch pool for gating. Over-fetched (vs the promotion cap)
 * because the value gate rejects some candidates; the list is severity-ordered
 * (confidence desc), so the pool holds the most promotable ones.
 */
const CONCERN_POOL_LIMIT = 30;

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

/** Result of gating a theme's open concerns for promotion. */
export interface PromotableConcernsResult {
  /** Concerns admitted by the value gate, in promotion-preference order. */
  passed: ConcernEntry[];
  /** Concerns excluded by the gate, with the first failing check as reason. */
  rejected: Array<{ concern: ConcernEntry; reason: ValueGateRejectReason }>;
  /** Effective toggle state at evaluation time. */
  gateEnabled: boolean;
}

/**
 * Per-source count of concerns already CONVERTED to tasks today (server-local
 * day) — the value gate's daily quota input. Fail-open: a DB error reports an
 * empty aggregation (quota treated as unused) because silently halting all
 * promotion on a transient failure is the worse outage.
 */
async function countConvertedTodayBySource(): Promise<Record<string, number>> {
  try {
    // convertConcernToTask sets sourceId to 'task_<id>' and @updatedAt bumps the
    // row, so "converted today" = task_-prefixed rows touched since local 0:00.
    // tags is a JSON string — no DB group-by possible; aggregate in JS.
    const rows = await prisma.knowledgeEntry.findMany({
      where: {
        sourceType: 'concern',
        sourceId: { startsWith: 'task_' },
        updatedAt: { gte: localDayStart() },
      },
      select: { tags: true },
      take: 500,
    });
    const counts: Record<string, number> = {};
    for (const row of rows as Array<{ tags: string }>) {
      let source = 'unknown';
      try {
        const tags = JSON.parse(row.tags || '[]') as string[];
        source =
          tags.find((t) => typeof t === 'string' && t.startsWith('source:'))?.slice(7) ?? 'unknown';
      } catch {
        // Unparseable tags — count the row under 'unknown'.
      }
      counts[source] = (counts[source] ?? 0) + 1;
    }
    return counts;
  } catch (err) {
    log.warn({ err }, '[backlog-promoter] Converted-today aggregation failed — quota fail-open');
    return {};
  }
}

/**
 * Saturation predicate injected into the value gate. NOTE: at CONVERSION time
 * the candidate itself is already in the open pool (unlike submit time), so it
 * self-matches once — cap 3 effectively means "2 other open concerns share the
 * theme". This is the gate that finally catches dedupKey'd floods (log_health)
 * which bypass the submit-time gate. Fail-open on DB errors.
 */
async function isSaturatedConcernTitle(title: string): Promise<boolean> {
  try {
    const anchorId = await findSaturatedTheme(title, {
      sourceType: 'concern',
      cap: 3,
      // Same salient default as the submit-time gate (concern-backlog-service).
      salient: Number(process.env.RAPITAS_CONCERN_SATURATION_SALIENT) || 5,
      openConcernOnly: true,
    });
    return anchorId != null;
  } catch {
    return false;
  }
}

/**
 * Gate a theme's open concerns through the value gate (証拠必須 / severity閾値 /
 * 語彙的飽和 / source別日次クォータ). The SINGLE source of truth shared by
 * hasPromotableBacklog and promoteBacklogForTheme — both must see the same
 * pass/reject split or the scheduler flaps between idle and running.
 *
 * @param themeId - Theme whose open concerns to gate. / 対象テーマID
 * @returns Admitted + rejected concerns and the toggle state. / 合否内訳
 */
export async function computePromotableConcerns(
  themeId: number,
): Promise<PromotableConcernsResult> {
  const gateEnabled = readValueGateEnabled();
  const { concerns } = await listConcerns({
    status: 'open',
    themeId,
    limit: CONCERN_POOL_LIMIT,
  }).catch(() => ({ concerns: [] as ConcernEntry[], total: 0 }));
  if (concerns.length === 0) return { passed: [], rejected: [], gateEnabled };

  const convertedTodayBySource = gateEnabled ? await countConvertedTodayBySource() : {};
  const { passed, rejected } = await evaluateConcernValueGate(concerns, {
    enabled: gateEnabled,
    isSaturatedTitle: isSaturatedConcernTitle,
    convertedTodayBySource,
  });
  if (rejected.length > 0) {
    const byReason: Record<string, number> = {};
    for (const r of rejected) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;
    log.info(
      { themeId, pool: concerns.length, passed: passed.length, byReason },
      '[backlog-promoter] Value gate excluded concerns',
    );
  }
  return { passed, rejected, gateEnabled };
}

/**
 * Whether the theme has an open (unmerged) PR tied to one of its tasks — the
 * 修復待ちPR guard that blocks the satiation verdict (要求B.1). DB-only by
 * design: this runs on the 12s tick path, so no gh CLI round-trips (merging is
 * AutoMergeWatcher's job). Fail-open: a DB error reports false so a transient
 * failure never wedges satiation evaluation.
 *
 * @param themeId - Theme to check. / 対象テーマID
 * @returns true when an open PR is linked to a theme task. / 修復待ちPRがあれば true
 */
export async function hasUnmergedRepairPr(themeId: number): Promise<boolean> {
  try {
    const openPrs = await prisma.gitHubPullRequest.findMany({
      where: { state: 'open' },
      select: { prNumber: true, linkedTaskId: true },
      take: 200,
    });
    if (openPrs.length === 0) return false;
    const linkedIds = openPrs.map((p) => p.linkedTaskId).filter((id): id is number => id != null);
    if (linkedIds.length > 0) {
      const linked = await prisma.task.count({ where: { id: { in: linkedIds }, themeId } });
      if (linked > 0) return true;
    }
    // Fallback: Task.githubPrId carries the PR NUMBER (pr-link.ts) for open PR
    // rows whose linkedTaskId was never set (e.g. webhook-synced rows).
    const prNumbers = openPrs.map((p) => p.prNumber);
    const viaNumber = await prisma.task.count({
      where: { themeId, githubPrId: { in: prNumbers } },
    });
    return viaNumber > 0;
  } catch (err) {
    log.warn({ err, themeId }, '[backlog-promoter] Repair-PR check failed — treating as none');
    return false;
  }
}

/**
 * Whether a promotion would create at least one task right now: the cap has room
 * (outstanding < limit) AND there is a GATE-PASSING open concern or an idea to
 * promote. Used to decide whether to auto-resume an idle theme — no side effects
 * (does not create). Gate-rejected concerns deliberately do NOT count: resuming
 * on them would immediately re-enter all_done (12s idle⇄running flap).
 *
 * @param themeId - Theme to check. / 対象テーマID
 * @returns true when promotion would yield a task. / 起票が発生する見込みなら true
 */
export async function hasPromotableBacklog(themeId: number): Promise<boolean> {
  const limit = await resolveLimit();
  if (limit <= 0) return false;
  const outstanding = await countOutstandingAutoCreated(themeId);
  if (outstanding >= limit) return false;
  const { passed } = await computePromotableConcerns(themeId);
  if (passed.length > 0) return true;
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

/** Promote one concern; returns true when a task was created. */
async function promoteConcern(
  themeId: number,
  concern: { id: number; severity: string },
): Promise<boolean> {
  try {
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
 * priority first (the list services order them). Concern candidates are the
 * value-gate PASSED set only (computePromotableConcerns) — rejected concerns
 * stay open but are never auto-promoted.
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
  const [gatedConcerns, ideaList, armStats, recentIdeaTitles] = await Promise.all([
    // Value gate (要求A): the same gated result hasPromotableBacklog uses, so the
    // resume decision and the actual promotion can never disagree (flap guard).
    computePromotableConcerns(themeId),
    listIdeas({ status: 'open', themeId, limit: ideaPool }).catch(() => ({
      ideas: [],
      total: 0,
    })),
    getBacklogArmStats(prisma, themeId),
    getRecentIdeaTaskTitles(prisma, themeId),
  ]);
  const concerns = [...gatedConcerns.passed];
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
      hasCriticalConcern: concerns.some((c) => CRITICAL_CONCERN_SEVERITIES.has(c.severity)),
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
