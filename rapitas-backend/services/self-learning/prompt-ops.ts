/**
 * Prompt Evolution Operations
 *
 * Records prompt evolution history and retrieves past prompt changes
 * to track improvement over time. Also summarizes the PromptEvolution table
 * (per-prompt entry/pending/completed counts and performance trend) — a
 * read-only view; it does NOT pick or promote a "winner" prompt, which would
 * be a behavior change outside this module's scope. Pattern and statistics
 * operations live in pattern-ops.ts and stats-ops.ts respectively.
 */
import { prisma } from '../../config/database';
import type { CreatePromptEvolutionInput } from './types';

/**
 * Records a prompt evolution entry linking before/after prompts to an experiment.
 *
 * @param input - Prompt evolution creation parameters / プロンプト進化の作成パラメータ
 * @returns Newly created PromptEvolution record / 作成されたPromptEvolutionレコード
 */
export async function recordPromptEvolution(input: CreatePromptEvolutionInput) {
  return prisma.promptEvolution.create({
    data: {
      experimentId: input.experimentId,
      category: input.category,
      beforePrompt: input.beforePrompt,
      afterPrompt: input.afterPrompt,
      improvement: input.improvement,
      performanceDelta: input.performanceDelta ?? 0,
    },
  });
}

/**
 * Returns the most recent 50 prompt evolution records, optionally filtered by category.
 *
 * @param category - Optional category filter / カテゴリフィルタ（省略可）
 * @returns Array of PromptEvolution records ordered by creation date / 作成日順のPromptEvolutionレコード一覧
 */
export async function getPromptEvolutionHistory(category?: string) {
  const where: Record<string, unknown> = {};
  if (category) where.category = category;

  return prisma.promptEvolution.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}

/** Minimal shape of a PromptEvolution row needed to summarize it. */
export interface PromptEvolutionRow {
  id: number;
  basePromptKey: string | null;
  category: string;
  status: string;
  performanceDelta: number;
  reason: string | null;
  improvement: string | null;
  createdAt: Date | string;
  // Lineage-tree node attributes (task #937) — additive, existing fields
  // above are untouched so /learning/prompt-evolution/summary stays
  // backward compatible for PromptEvolutionSummary/Proposals.
  taskType?: string | null;
  significanceLevel?: string | null;
  abTested?: boolean;
  treeConfidence?: string;
}

/** One entry within a group's `recentEntries` list. */
export interface PromptEvolutionRecentEntry {
  id: number;
  status: string;
  performanceDelta: number;
  reason: string | null;
  improvement: string | null;
  createdAt: string;
  /** Node attribute 1/5 (task #937): applied task type/role. */
  taskType: string | null;
  /** Node attribute 2/5 (part b): copied from ComparisonSummary.uncertainty — see prompt-evolution-settle.ts. */
  significanceLevel: string | null;
  /** Node attribute 3/5: whether a shadow-run A/B comparison backs this row. */
  abTested: boolean;
  /** Node attribute 5/5: derived trust label — see prompt-evolution-tree.ts. */
  treeConfidence: string;
}

/** Aggregated view of every PromptEvolution row sharing one basePromptKey/category. */
export interface PromptEvolutionGroupSummary {
  /** basePromptKey when set, else the legacy `category` field / グルーピングキー */
  key: string;
  /** Total rows in this group, any status / 総エントリ数 */
  entryCount: number;
  /** Rows awaiting a decision (status pending or proposed) / 未判断数 */
  pendingCount: number;
  /** Rows approved for injection but without a recorded outcome yet / 承認済み(結果未記録)数 */
  approvedCount: number;
  /** Rows rejected by a human / 却下数 */
  rejectedCount: number;
  /** Rows with a recorded before/after pair (status="completed") / 完了数 */
  completedCount: number;
  /** performanceDelta of the most recently created completed row, or null / 直近の性能差分 */
  latestPerformanceDelta: number | null;
  /** Mean performanceDelta across completed rows, or null when none completed / 平均性能差分 */
  averagePerformanceDelta: number | null;
  /** Most recent rows (any status), newest first / 直近エントリ一覧 */
  recentEntries: PromptEvolutionRecentEntry[];
}

/**
 * Groups PromptEvolution rows by basePromptKey (falling back to `category`
 * for legacy rows recorded before basePromptKey existed) and computes
 * per-group counts and performance trend. Pure function: no I/O, so it can
 * be unit-tested against fixture arrays without a database.
 *
 * @param rows - PromptEvolution rows, any order / PromptEvolution行（順不同）
 * @param recentLimit - Max entries kept per group's recentEntries / グループ毎の直近件数上限
 * @returns One summary per group, ordered by most recent activity first / グループ毎の要約
 */
export function summarizePromptEvolution(
  rows: PromptEvolutionRow[],
  recentLimit = 5,
): PromptEvolutionGroupSummary[] {
  const groups = new Map<string, PromptEvolutionRow[]>();
  for (const row of rows) {
    const key = row.basePromptKey?.trim() || row.category || 'uncategorized';
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  const summaries: PromptEvolutionGroupSummary[] = [];
  for (const [key, groupRows] of groups) {
    const sorted = [...groupRows].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const completed = sorted.filter((r) => r.status === 'completed');
    // NOTE: pending used to be "everything not completed", which counted
    // approved and rejected rows as still waiting (audit 2026-09-06).
    const pendingCount = sorted.filter(
      (r) => r.status === 'pending' || r.status === 'proposed',
    ).length;
    const approvedCount = sorted.filter((r) => r.status === 'approved').length;
    const rejectedCount = sorted.filter((r) => r.status === 'rejected').length;

    const averagePerformanceDelta =
      completed.length > 0
        ? round4(completed.reduce((sum, r) => sum + r.performanceDelta, 0) / completed.length)
        : null;

    summaries.push({
      key,
      entryCount: sorted.length,
      pendingCount,
      approvedCount,
      rejectedCount,
      completedCount: completed.length,
      latestPerformanceDelta: completed.length > 0 ? completed[0].performanceDelta : null,
      averagePerformanceDelta,
      recentEntries: sorted.slice(0, recentLimit).map((r) => ({
        id: r.id,
        status: r.status,
        performanceDelta: r.performanceDelta,
        reason: r.reason,
        improvement: r.improvement,
        createdAt: new Date(r.createdAt).toISOString(),
        taskType: r.taskType ?? null,
        significanceLevel: r.significanceLevel ?? null,
        abTested: r.abTested ?? false,
        treeConfidence: r.treeConfidence ?? 'low',
      })),
    });
  }

  // Most recently active group first, so the UI's top card is the freshest one.
  summaries.sort((a, b) => {
    const aLatest = a.recentEntries[0]?.createdAt ?? '';
    const bLatest = b.recentEntries[0]?.createdAt ?? '';
    return bLatest.localeCompare(aLatest);
  });

  return summaries;
}

/**
 * Loads all PromptEvolution rows and delegates to summarizePromptEvolution
 * for grouping/aggregation. Read-only — a single Prisma query, no writes,
 * and no winner-promotion side effects.
 *
 * @returns Per-group summaries, most recently active first / グループ毎の要約
 */
export async function getPromptEvolutionSummary(): Promise<PromptEvolutionGroupSummary[]> {
  // NOTE: cast via `unknown` rather than `any` — same feature-detection
  // reasoning as prompt-evolution-runner.ts's promptEvolutionDelegate: the
  // task #937 columns (taskType/significanceLevel/abTested/treeConfidence)
  // are added to schema/experiments.prisma but the generated Prisma client
  // is not regenerated until the user restarts the server (CLAUDE.md §1).
  const findMany = prisma.promptEvolution.findMany as unknown as (
    args: unknown,
  ) => Promise<PromptEvolutionRow[]>;
  const rows = await findMany({
    select: {
      id: true,
      basePromptKey: true,
      category: true,
      status: true,
      performanceDelta: true,
      reason: true,
      improvement: true,
      createdAt: true,
      taskType: true,
      significanceLevel: true,
      abTested: true,
      treeConfidence: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  return summarizePromptEvolution(rows);
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
