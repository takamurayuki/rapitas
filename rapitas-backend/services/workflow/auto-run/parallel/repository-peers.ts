/**
 * repository-peers
 *
 * Finds the other themes that work on the same repository (Theme.workingDirectory)
 * and the tasks they are running (task 1552), so parallel-safety and the overlap
 * guard can look across a theme split such as theme 49. Not responsible for
 * judging overlaps.
 */
import type { PrismaClient } from '../../../../generated/prisma-postgres';
import { parseCompanions } from './companion-json';

/**
 * Normalize a working directory for "same repository" comparison: `\` → `/`,
 * no trailing `/`, lower case (Windows paths are case-insensitive).
 *
 * @param dir - Working directory / 作業ディレクトリ
 * @returns Normalized key, or null when empty / 正規化した値
 */
export function normalizeWorkingDirectory(dir: string | null | undefined): string | null {
  if (!dir || !dir.trim()) return null;
  return dir.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() || null;
}

type ThemeRow = { id: number; workingDirectory: string | null };

/**
 * Ids of every theme on the same repository as `themeId`, itself included.
 * A theme without a working directory is only itself. Read errors → itself.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param themeId - Theme / テーマID
 * @param cwd - Known working directory (skips one read) / 既知の作業ディレクトリ
 * @returns Theme ids and the normalized directory / テーマID一覧
 */
export async function repositoryThemeIds(
  prisma: PrismaClient,
  themeId: number,
  cwd?: string | null,
): Promise<{ themeIds: number[]; cwd: string | null }> {
  try {
    let dir = cwd ?? null;
    if (dir == null) {
      const theme = await prisma.theme.findUnique({
        where: { id: themeId },
        select: { workingDirectory: true },
      });
      dir = theme?.workingDirectory ?? null;
    }
    const key = normalizeWorkingDirectory(dir);
    if (!key) return { themeIds: [themeId], cwd: dir };
    const themes = (await prisma.theme.findMany({
      where: { workingDirectory: { not: null } },
      select: { id: true, workingDirectory: true },
    })) as ThemeRow[];
    const ids = themes
      .filter((t) => normalizeWorkingDirectory(t.workingDirectory) === key)
      .map((t) => t.id);
    return { themeIds: [...new Set([themeId, ...ids])], cwd: dir };
  } catch {
    return { themeIds: [themeId], cwd: cwd ?? null };
  }
}

/** A task running in another theme of the same repository. */
export interface PeerActiveTask {
  themeId: number;
  taskId: number;
}

/**
 * Running tasks of the OTHER themes on the same repository: each theme's head
 * and companions, plus any theme-tagged active queue item. Read errors → [].
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param themeId - Theme being advanced / 対象テーマ
 * @returns Peer tasks / 他テーマの動作中タスク
 */
export async function loadRepositoryPeerActiveTasks(
  prisma: PrismaClient,
  themeId: number,
): Promise<PeerActiveTask[]> {
  try {
    const { themeIds } = await repositoryThemeIds(prisma, themeId);
    const peers = themeIds.filter((id) => id !== themeId);
    if (peers.length === 0) return [];
    const out = new Map<number, PeerActiveTask>();
    // NOTE: no `select` — companionTasksJson is pending client regeneration.
    const runs = (await prisma.themeAutoRun.findMany({
      where: { themeId: { in: peers }, status: { not: 'idle' } },
    })) as unknown as Array<{
      themeId: number;
      currentTaskId: number | null;
      companionTasksJson?: unknown;
    }>;
    for (const r of runs) {
      if (r.currentTaskId != null)
        out.set(r.currentTaskId, { themeId: r.themeId, taskId: r.currentTaskId });
      for (const c of parseCompanions(r.companionTasksJson)) {
        out.set(c.taskId, { themeId: r.themeId, taskId: c.taskId });
      }
    }
    const items = await prisma.workflowQueueItem.findMany({
      where: { themeId: { in: peers }, status: { in: ['queued', 'running', 'waiting_approval'] } },
      select: { taskId: true, themeId: true },
    });
    for (const i of items) {
      if (i.themeId != null && !out.has(i.taskId)) {
        out.set(i.taskId, { themeId: i.themeId, taskId: i.taskId });
      }
    }
    return [...out.values()];
  } catch {
    return [];
  }
}
