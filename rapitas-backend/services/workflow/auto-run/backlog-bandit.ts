/**
 * backlog-bandit
 *
 * Non-stationary bandit that adaptively splits backlog promotion between
 * OPEN concerns and ideas per theme, replacing the fixed "ideas only after the
 * concern backlog is empty" hierarchy. Reward is REALIZED value of previously
 * promoted tasks (completed + first-try bonus), not the ideation-time score —
 * LLM-authored value estimates are systematically optimistic and re-rank after
 * execution (Ideation-Execution Gap, arXiv:2506.20803); category-level bandits
 * on measured gain beat fixed curricula (SEC, arXiv:2505.14970). Not
 * responsible for creating tasks — backlog-task-promoter consumes the arm choice.
 */
import type { PrismaClient } from '@prisma/client';
import { createLogger } from '../../../config/logger';

const log = createLogger('auto-run:backlog-bandit');

export type BacklogArm = 'concern' | 'idea';

/** Realized-outcome statistics for one arm. */
export interface ArmStats {
  /** Terminal (done/blocked) promoted tasks observed. */
  pulls: number;
  /** Sum of realized rewards over those pulls (each in [0,1]). */
  rewardSum: number;
}

/** Sliding window of recent promoted-task outcomes per theme. */
const OUTCOME_WINDOW = 20;

/** Concern severities that always run first (safety override — never wait behind ideas). */
export const CRITICAL_CONCERN_SEVERITIES: ReadonlySet<string> = new Set(['urgent']);

/** Transition causes that mean the task needed repair (not first-try). */
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

/**
 * Pick the next backlog arm by UCB1 over realized rewards. Pure and
 * unit-testable; deterministic (exploration comes from the UCB bonus, not RNG).
 *
 * Rules, in order:
 *  1. An arm with no open items is not selectable (both empty → null).
 *  2. A critical open concern (severity in CRITICAL_CONCERN_SEVERITIES)
 *     forces 'concern' — urgent bugs/security never wait behind ideas.
 *  3. Otherwise UCB1: mean reward + sqrt(2·ln(N)/n); an unpulled arm scores
 *     Infinity so both arms are always explored. Ties break to 'concern'
 *     (the conservative prior of the old fixed hierarchy).
 *
 * @param p - Arm stats, open item counts, and critical-concern presence. / 腕の統計と在庫
 * @returns The arm to promote from next, or null when both are empty. / 次に起票する腕
 */
export function selectBacklogArm(p: {
  concern: ArmStats;
  idea: ArmStats;
  openConcerns: number;
  openIdeas: number;
  hasCriticalConcern: boolean;
}): BacklogArm | null {
  const concernAvailable = p.openConcerns > 0;
  const ideaAvailable = p.openIdeas > 0;
  if (!concernAvailable && !ideaAvailable) return null;
  if (concernAvailable && !ideaAvailable) return 'concern';
  if (!concernAvailable && ideaAvailable) return 'idea';

  if (p.hasCriticalConcern) return 'concern';

  const total = p.concern.pulls + p.idea.pulls;
  const ucb = (s: ArmStats): number => {
    if (s.pulls === 0) return Infinity;
    return s.rewardSum / s.pulls + Math.sqrt((2 * Math.log(Math.max(total, 1))) / s.pulls);
  };
  const concernScore = ucb(p.concern);
  const ideaScore = ucb(p.idea);
  return concernScore >= ideaScore ? 'concern' : 'idea';
}

/**
 * Realized reward for one terminal promoted task: 1.0 for a first-try
 * completion, 0.6 for a completion that needed repair bounces, 0 otherwise.
 * Pure and unit-testable.
 *
 * @param status - Terminal task status. / 終端ステータス
 * @param hadTrouble - Whether repair/bounce transitions were recorded. / 修復有無
 * @returns Reward in [0,1]. / 報酬
 */
export function realizedReward(status: string, hadTrouble: boolean): number {
  if (status !== 'done' && status !== 'completed') return 0;
  return hadTrouble ? 0.6 : 1.0;
}

/**
 * Measure recent realized rewards per arm for a theme, attributing each
 * terminal auto-created task back to its origin:
 *  - concern-promoted: KnowledgeEntry(sourceType='concern', sourceId='task_<id>')
 *  - idea-promoted:    KnowledgeEntry(sourceType='idea_box', sourceId='used_task_<id>')
 * Unattributable tasks (manual, or created before this feature) are ignored.
 * Best-effort: DB errors return empty stats (bandit then explores both arms).
 *
 * @param prisma - Prisma client. / Prismaクライアント
 * @param themeId - Theme to measure. / 対象テーマ
 * @returns Per-arm stats over the recent outcome window. / 腕ごとの実測統計
 */
export async function getBacklogArmStats(
  prisma: PrismaClient,
  themeId: number,
): Promise<{ concern: ArmStats; idea: ArmStats }> {
  const empty = { concern: { pulls: 0, rewardSum: 0 }, idea: { pulls: 0, rewardSum: 0 } };
  try {
    const recent = await prisma.task.findMany({
      where: {
        themeId,
        parentId: null,
        autoCreatedFromBacklog: true,
        status: { in: ['done', 'completed', 'blocked'] },
      },
      orderBy: [{ completedAt: 'desc' }, { updatedAt: 'desc' }],
      take: OUTCOME_WINDOW,
      select: { id: true, status: true },
    });
    if (recent.length === 0) return empty;

    const ids = recent.map((t) => t.id);
    const [concernRows, ideaRows, troubleRows] = await Promise.all([
      prisma.knowledgeEntry.findMany({
        where: { sourceType: 'concern', sourceId: { in: ids.map((id) => `task_${id}`) } },
        select: { sourceId: true },
      }),
      prisma.knowledgeEntry.findMany({
        where: { sourceType: 'idea_box', sourceId: { in: ids.map((id) => `used_task_${id}`) } },
        select: { sourceId: true },
      }),
      prisma.workflowTransition.findMany({
        where: { taskId: { in: ids }, cause: { in: TROUBLE_CAUSES } },
        select: { taskId: true },
        distinct: ['taskId'],
      }),
    ]);
    const concernTaskIds = new Set(
      concernRows.map((r) => parseInt((r.sourceId ?? '').replace('task_', ''), 10)),
    );
    const ideaTaskIds = new Set(
      ideaRows.map((r) => parseInt((r.sourceId ?? '').replace('used_task_', ''), 10)),
    );
    const troubled = new Set(troubleRows.map((r) => r.taskId));

    const stats = { concern: { pulls: 0, rewardSum: 0 }, idea: { pulls: 0, rewardSum: 0 } };
    for (const t of recent) {
      const arm: BacklogArm | null = concernTaskIds.has(t.id)
        ? 'concern'
        : ideaTaskIds.has(t.id)
          ? 'idea'
          : null;
      if (!arm) continue;
      stats[arm].pulls += 1;
      stats[arm].rewardSum += realizedReward(t.status, troubled.has(t.id));
    }
    return stats;
  } catch (err) {
    log.warn({ err, themeId }, '[backlog-bandit] Failed to compute arm stats — exploring');
    return empty;
  }
}
