/**
 * Continue-Execution PR Auto-Link
 *
 * Detects a PR the agent created directly via `gh pr create` while running
 * under POST /tasks/:id/continue-execution — a path that bypasses the
 * regular performAutoCommitAndPR → linkAutoCreatedPr pipeline — and links it
 * to its task using the same task-identity-verified pipeline the regular
 * flow uses. Not responsible for creating the PR itself.
 */

import { PrismaClient } from '../../generated/prisma-postgres';
import { createLogger } from '../../config/logger';
import { runGhCommand } from './gh-client';
import { extractTaskMarkerId } from './pr-ownership';
import { linkAutoCreatedPr } from './pr-link';

const log = createLogger('github-service:continue-execution-pr-link');
type PrismaClientInstance = InstanceType<typeof PrismaClient>;

interface GhPrListEntry {
  number?: number;
  url?: string;
  baseRefName?: string;
  title?: string;
}

/** Parameters for {@link linkContinueExecutionPr}. */
export interface LinkContinueExecutionPrParams {
  /** Task the continuation ran for. / 継続実行の対象タスクID */
  taskId: number;
  /** Session branch the continuation worked on. / セッションのブランチ名 */
  branchName?: string | null;
  /** Working directory to run `gh` from (must still be a git checkout). / ghの実行ディレクトリ */
  cwd: string;
}

/**
 * Detect and link a PR a continue-execution run created directly via
 * `gh pr create`, without going through the regular auto-commit pipeline.
 *
 * Best-effort: skips silently when there is nothing to detect (no
 * branchName, already linked, no open PR on the branch, or the found PR's
 * title marker does not name this task) and swallows all errors so a `gh`
 * failure never blocks the continuation's completion handling.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param params - Task/branch/cwd context / タスク・ブランチ・作業ディレクトリ
 */
export async function linkContinueExecutionPr(
  prisma: PrismaClientInstance,
  params: LinkContinueExecutionPrParams,
): Promise<void> {
  const { taskId, branchName, cwd } = params;
  if (!branchName) return;

  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { githubPrId: true },
    });
    if (task?.githubPrId != null) return;

    const stdout = await runGhCommand(
      [
        'pr',
        'list',
        '--head',
        branchName,
        '--state',
        'open',
        '--json',
        'number,url,baseRefName,title',
        '--jq',
        '.[0]',
      ],
      cwd,
      { skipLog: true },
    );
    const trimmed = stdout.trim();
    if (!trimmed || trimmed === 'null') return;

    const pr = JSON.parse(trimmed) as GhPrListEntry;
    if (!pr.number || !pr.url) return;

    const markerTaskId = extractTaskMarkerId(pr.title);
    if (markerTaskId !== taskId) {
      log.warn(
        { taskId, prNumber: pr.number, markerTaskId, title: pr.title },
        '[linkContinueExecutionPr] Found open PR on branch but its title marker does not name this task — refusing to link',
      );
      return;
    }

    await linkAutoCreatedPr(prisma, {
      taskId,
      prNumber: pr.number,
      prUrl: pr.url,
      title: pr.title ?? '',
      headBranch: branchName,
      baseBranch: pr.baseRefName ?? '',
      workingDirectory: cwd,
    });
  } catch (err) {
    log.warn({ err, taskId, branchName }, '[linkContinueExecutionPr] PR detection/link failed');
  }
}
