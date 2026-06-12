/**
 * GitHub Auto-PR Linking
 *
 * Persists a PR that the workflow auto-created via `gh pr create` into the local
 * GitHubPullRequest table and links it to its task, so the "PRを開く" button can
 * resolve the task → local PR id and navigate to the PR detail page.
 * Not responsible for creating the PR on GitHub — that lives in branch-pr-ops.ts.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { PrismaClient } from '@prisma/client';
import { createLogger } from '../../config/logger';

const log = createLogger('github-service:pr-link');
const execAsync = promisify(exec);
type PrismaClientInstance = InstanceType<typeof PrismaClient>;

/** Parameters for {@link linkAutoCreatedPr}. */
export interface LinkAutoCreatedPrParams {
  /** Task the PR was generated for. / PRの生成元タスク */
  taskId: number;
  /** PR number parsed from `gh pr create` output. / PR番号 */
  prNumber: number;
  /** PR web URL. / PRのURL */
  prUrl: string;
  /** PR title used at creation. / PRタイトル */
  title: string;
  /** Head (feature) branch the PR was opened from. / ヘッドブランチ */
  headBranch: string;
  /** Base branch the PR targets. / ベースブランチ */
  baseBranch: string;
  /** Theme repository URL, when known, used to pick the integration. / リポジトリURL */
  repositoryUrl?: string | null;
  /** Working directory, used as a git-remote fallback for the repo identity. / 作業ディレクトリ */
  workingDirectory?: string | null;
}

/**
 * Extract `owner/repo` (lowercased) from a GitHub remote URL.
 *
 * @param url - https/ssh GitHub URL / GitHubのURL
 * @returns `{ owner, repo }` or null when the URL is not parseable / 解析不能ならnull
 */
function parseOwnerRepo(url: string | null | undefined): { owner: string; repo: string } | null {
  if (!url) return null;
  // Matches https://github.com/owner/repo(.git) and git@github.com:owner/repo(.git)
  const m = url.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!m) return null;
  return { owner: m[1].toLowerCase(), repo: m[2].toLowerCase() };
}

/**
 * Resolve the GitHubIntegration that owns the repo behind an auto-created PR.
 * Prefers an owner/repo match (from the theme URL, else the git remote); falls
 * back to the sole integration when exactly one exists.
 *
 * @returns Matching integration id, or null when none can be resolved / 一致する統合ID
 */
async function resolveIntegrationId(
  prisma: PrismaClientInstance,
  repositoryUrl: string | null | undefined,
  workingDirectory: string | null | undefined,
): Promise<number | null> {
  let ident = parseOwnerRepo(repositoryUrl);
  if (!ident && workingDirectory) {
    try {
      const { stdout } = await execAsync('git remote get-url origin', {
        cwd: workingDirectory,
        encoding: 'utf8',
      });
      ident = parseOwnerRepo(stdout.trim());
    } catch {
      /* no remote — fall through to the sole-integration heuristic */
    }
  }

  const integrations = await prisma.gitHubIntegration.findMany({
    select: { id: true, ownerName: true, repositoryName: true },
  });
  if (integrations.length === 0) return null;

  if (ident) {
    const match = integrations.find(
      (i) =>
        i.ownerName.toLowerCase() === ident.owner && i.repositoryName.toLowerCase() === ident.repo,
    );
    if (match) return match.id;
  }

  // Unambiguous when only one integration is configured (the desktop default).
  return integrations.length === 1 ? integrations[0].id : null;
}

/**
 * Persist an auto-created PR locally and link it to its task.
 *
 * Best-effort: any failure is logged and swallowed so a persistence problem
 * never aborts the task-completion flow. Sets both the direct
 * `GitHubPullRequest.linkedTaskId` link and the `Task.githubPrId` fallback the
 * by-task resolver reads.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param params - PR identity and repo hints / PRの識別情報
 * @returns Local GitHubPullRequest id, or null when it could not be persisted / ローカルPR ID
 */
export async function linkAutoCreatedPr(
  prisma: PrismaClientInstance,
  params: LinkAutoCreatedPrParams,
): Promise<number | null> {
  const { taskId, prNumber, prUrl, title, headBranch, baseBranch } = params;
  try {
    const integrationId = await resolveIntegrationId(
      prisma,
      params.repositoryUrl,
      params.workingDirectory,
    );
    if (integrationId == null) {
      log.warn(
        { taskId, prNumber },
        '[linkAutoCreatedPr] No GitHub integration resolved — PR not persisted locally; "PRを開く" will not navigate.',
      );
      return null;
    }

    const integration = await prisma.gitHubIntegration.findUnique({
      where: { id: integrationId },
      select: { ownerName: true },
    });

    const now = new Date();
    const pr = await prisma.gitHubPullRequest.upsert({
      where: { integrationId_prNumber: { integrationId, prNumber } },
      // Link an existing row (e.g. one a prior webhook sync already pulled in)
      // without clobbering fields a real sync owns.
      update: { linkedTaskId: taskId, url: prUrl, lastSyncedAt: now },
      create: {
        integrationId,
        prNumber,
        title,
        state: 'open',
        headBranch,
        baseBranch,
        authorLogin: integration?.ownerName ?? 'rapitas-agent',
        url: prUrl,
        linkedTaskId: taskId,
        lastSyncedAt: now,
      },
      select: { id: true },
    });

    // Fallback path for the by-task resolver, and the source of truth other
    // task views read.
    await prisma.task.update({ where: { id: taskId }, data: { githubPrId: prNumber } });

    log.info({ taskId, prNumber, localPrId: pr.id }, '[linkAutoCreatedPr] PR linked to task');
    return pr.id;
  } catch (err) {
    log.error({ err, taskId, prNumber }, '[linkAutoCreatedPr] Failed to persist/link auto PR');
    return null;
  }
}
