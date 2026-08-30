/**
 * auto-run-advance-scope
 *
 * Builds the scope-overlap selection context (task 573 B): the union of
 * changed files across a theme's open auto-PRs (gh, TTL-cached) plus a
 * plan-file loader. Split out of auto-run-advance-select.ts (task 784) to
 * stay under the file-size ratchet. Not responsible for task selection
 * itself — see auto-run-selection.ts.
 */
import type { PrismaClient } from '../../../generated/prisma-postgres';
import { getPrChangedFiles } from './open-pr-files-cache';
import { type ScopeOverlapContext } from './auto-run-selection';

/**
 * Build the scope-overlap selection context (task 573 B): the union of
 * changed files across the theme's open auto-PRs (gh, TTL-cached) plus a
 * plan-file loader (WorkflowFile plan → parsePlanFiles). Returns undefined
 * whenever there is nothing to compare (no open PRs, no cwd, no files) so
 * selection keeps its legacy path.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param themeId - Theme being advanced / 対象テーマ
 * @param openAutoPrs - The theme's open auto-created PRs / オープン自動PR一覧
 */
export async function buildScopeOverlapContext(
  prisma: PrismaClient,
  themeId: number,
  openAutoPrs: Array<{ prNumber: number }>,
): Promise<ScopeOverlapContext | undefined> {
  if (openAutoPrs.length === 0) return undefined;
  const theme = await prisma.theme
    .findUnique({ where: { id: themeId }, select: { workingDirectory: true } })
    .catch(() => null);
  const cwd = theme?.workingDirectory;
  if (!cwd) return undefined;

  const fileSets = await Promise.all(openAutoPrs.map((pr) => getPrChangedFiles(cwd, pr.prNumber)));
  const openPrFiles = [...new Set(fileSets.flat())];
  if (openPrFiles.length === 0) return undefined; // gh failed for all → fail-open

  return {
    openPrFiles,
    getPlanFiles: async (taskId: number) => {
      // Lazy import keeps the workflow-file module graph out of this
      // scheduler's static test surface.
      const { readWorkflowFile } = await import('../workflow-file-utils');
      const { parsePlanFiles } = await import('../../agents/verification/scope-check');
      const plan = await readWorkflowFile(taskId, 'plan').catch(() => null);
      if (!plan) return []; // no plan (lightweight) → never deferred
      return parsePlanFiles(plan);
    },
  };
}
