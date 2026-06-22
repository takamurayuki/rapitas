/**
 * PR Precondition Guard
 *
 * Resolves a GitHubPullRequest by ID and validates its integration before any
 * external API call. Throws on missing PR or integration so callers never reach
 * the external API unnecessarily.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { NotFoundError, parseId } from '../../middleware/error-handler';
import { makeOwnerRepoString, type OwnerRepoString } from '../../services/github/owner-repo';

/**
 * Resolved PR with its integration and a pre-built `owner/repo` string.
 */
export interface ResolvedPr {
  pr: Prisma.GitHubPullRequestGetPayload<{ include: { integration: true } }>;
  repo: OwnerRepoString;
}

/**
 * Resolve a GitHubPullRequest by route-param ID and validate its integration.
 *
 * @param id - Raw route parameter value (string or number). / ルートパラメータのID
 * @returns Resolved PR record with its integration and `repo` string. / PR・integration・repo文字列
 * @throws {ValidationError} When `id` is not a positive integer. / IDが正の整数でない場合
 * @throws {NotFoundError} When the PR or its integration is not found. / PRまたはintegrationが存在しない場合
 */
export async function resolvePrOrThrow(id: string | number): Promise<ResolvedPr> {
  const numericId = parseId(id, 'PR ID');

  const pr = await prisma.gitHubPullRequest.findUnique({
    where: { id: numericId },
    include: { integration: true },
  });

  if (!pr) {
    throw new NotFoundError('PR not found', 'PR_NOT_FOUND');
  }

  if (!pr.integration) {
    throw new NotFoundError('PR integration not found', 'PR_INTEGRATION_NOT_FOUND');
  }

  const repo = makeOwnerRepoString(pr.integration.ownerName, pr.integration.repositoryName);
  return { pr, repo };
}
