/**
 * head-parallel-filter
 *
 * Parallel-safety filter for choosing a theme's HEAD task (task 1552, やること
 * 11): the tasks running in other themes on the same repository are the
 * opponents. Their plans may be missing, so only the dependency rules refuse
 * then (file rules fail open). Not responsible for companion selection.
 */
import type { PrismaClient } from '../../../../generated/prisma-postgres';
import type { ParallelFilter } from './parallel-types';
import type { ParallelFilterDeps } from './companion-selection';
import { loadRepositoryPeerActiveTasks } from './repository-peers';

/**
 * Build the head filter, or undefined when no other theme of the repository
 * runs anything (selection then keeps its pre-task path exactly).
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param themeId - Theme selecting its head / 先頭を選ぶテーマ
 * @param deps - Test overrides (plan reader, import check) / テスト用差し替え
 * @returns Filter or undefined / フィルタ（相手がいなければ undefined）
 */
export async function buildHeadParallelFilter(
  prisma: PrismaClient,
  themeId: number,
  deps: Partial<ParallelFilterDeps> = {},
): Promise<ParallelFilter | undefined> {
  const peers = await loadRepositoryPeerActiveTasks(prisma, themeId);
  if (peers.length === 0) return undefined;
  const theme = await prisma.theme
    .findUnique({ where: { id: themeId }, select: { workingDirectory: true } })
    .catch(() => null);
  // Lazy: companion-selection pulls the plan-parsing graph, needed only here.
  const { buildParallelFilter } = await import('./companion-selection');
  return buildParallelFilter(
    prisma,
    peers.map((p) => ({ taskId: p.taskId, sameTheme: false })),
    theme?.workingDirectory ?? null,
    deps,
  );
}
