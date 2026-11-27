/**
 * auto-run-selection-rank
 *
 * Ordering helpers of the theme auto-run task selection: priority rank, the learnable-band score
 * for priority ties, and the theme's recent success rate. Split out of auto-run-selection.ts
 * (file-size limit) and re-exported there; no behaviour change.
 */
import type { PrismaClient } from '../../../generated/prisma-postgres';

/**
 * Task priority ordering for selection: lower number = runs first.
 * Stored priority is a STRING, so it must be ranked in JS — a SQL `desc` on the
 * string sorts alphabetically (urgent>medium>low>high), which is NOT priority order.
 */
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

/**
 * Resolve a priority string to its rank (higher priority → lower number).
 *
 * @param priority - Task priority string / タスク優先度
 * @returns Numeric rank; unknown/empty treated as medium / 数値ランク（不明はmedium扱い）
 */
export function priorityRank(priority: string | null | undefined): number {
  if (!priority) return PRIORITY_RANK.medium;
  const r = PRIORITY_RANK[priority.toLowerCase()];
  return r === undefined ? PRIORITY_RANK.medium : r;
}

/**
 * Learnable-band value score for priority ties (R6): prefer tasks whose
 * complexity sits in the band the theme can currently LEARN from — neither
 * trivial nor beyond its measured ability. Proposer rewards centered on an
 * intermediate success band drive the strongest self-improvement (AZR,
 * arXiv:2505.03335). The theme's recent success rate moves the target band:
 * succeeding often → reach for harder work; failing often → consolidate on
 * easier work. Pure and unit-testable.
 *
 * @param complexityScore - Task complexity 0-100 (null = not yet assessed). / 複雑度
 * @param themeSuccessRate - Recent completion rate 0-1 (null = no data). / 直近成功率
 * @returns Score in [-1, 0]; higher = closer to the learnable band. / 帯スコア
 */
export function valueBandScore(
  complexityScore: number | null | undefined,
  themeSuccessRate: number | null | undefined,
): number {
  if (themeSuccessRate == null) return 0; // no signal — keep legacy ordering
  const rate = Math.max(0, Math.min(1, themeSuccessRate));
  const target = 20 + 60 * rate; // 20 (struggling) … 80 (cruising)
  // Unassessed complexity = a fixed mid-distance penalty, so tasks with REAL
  // in-band evidence outrank unknowns, but unknowns still beat far-out-of-band.
  if (complexityScore == null) return -0.3;
  const c = Math.max(0, Math.min(100, complexityScore));
  return -Math.abs(c - target) / 100;
}

/**
 * Recent completion rate for a theme's terminal top-level tasks (done vs
 * blocked), used to position the learnable band. Returns null with fewer than
 * 3 samples so selection keeps its legacy ordering until there is signal.
 *
 * @param prisma - Prisma client instance
 * @param themeId - Theme to measure / 対象テーマ
 * @returns Success rate 0-1, or null when data is insufficient. / 直近成功率
 */
export async function recentThemeSuccessRate(
  prisma: PrismaClient,
  themeId: number,
): Promise<number | null> {
  try {
    const recent = await prisma.task.findMany({
      where: { themeId, parentId: null, status: { in: ['done', 'completed', 'blocked'] } },
      orderBy: [{ completedAt: 'desc' }, { updatedAt: 'desc' }],
      take: 10,
      select: { status: true },
    });
    if (recent.length < 3) return null;
    const done = recent.filter((t) => t.status === 'done' || t.status === 'completed').length;
    return done / recent.length;
  } catch {
    return null;
  }
}
