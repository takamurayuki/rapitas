/**
 * pr-lookup
 *
 * Repo-scoped GitHubPullRequest lookups by prNumber. GitHubPullRequest holds
 * every integration's PRs in one table and prNumber is only unique per repo
 * (composite @@unique([integrationId, prNumber])), so a prNumber-only lookup
 * can silently return another project's same-numbered PR (observed: task 491 /
 * tripla adopting the converter repo's #7 — task #596). Every prNumber lookup
 * must go through this module so the scope cannot be forgotten again.
 * Not responsible for creating or linking PRs — that lives in pr-link.ts.
 */
import type { Prisma, PrismaClient } from '../../generated/prisma-postgres';
import { resolveIntegrationId } from './pr-link';

type PrismaClientInstance = InstanceType<typeof PrismaClient>;

/**
 * Find the single OPEN PR row for a prNumber inside one repository.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param integrationId - GitHubIntegration that owns the repo / 対象リポジトリの統合ID
 * @param prNumber - PR number within that repo / リポジトリ内のPR番号
 * @param select - Fields to return / 取得するフィールド
 * @returns The matching open PR row, or null when none exists in THIS repo / 一致するopen PR行
 */
export async function findScopedOpenPr<S extends Prisma.GitHubPullRequestSelect>(
  prisma: PrismaClientInstance,
  integrationId: number,
  prNumber: number,
  select: S,
): Promise<Prisma.GitHubPullRequestGetPayload<{ select: S }> | null> {
  // (integrationId, prNumber) is the table's composite unique key, so at most
  // one row can match — the state filter only narrows it further.
  return prisma.gitHubPullRequest.findFirst({
    where: { integrationId, prNumber, state: 'open' },
    select,
  });
}

/**
 * Resolve the GitHubIntegration owning a task's repository, from the task's
 * theme repositoryUrl / working directories. Callers must fail closed (skip
 * their prNumber lookup) on null — guessing risks another repo's PR.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param taskId - Task whose repo identity to resolve / 対象タスクID
 * @returns Matching integration id, or null when unresolvable / 一致する統合ID
 */
export async function resolveIntegrationIdForTask(
  prisma: PrismaClientInstance,
  taskId: number,
): Promise<number | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      workingDirectory: true,
      theme: { select: { repositoryUrl: true, workingDirectory: true } },
    },
  });
  if (!task) return null;
  return resolveIntegrationId(
    prisma,
    task.theme?.repositoryUrl ?? null,
    task.workingDirectory ?? task.theme?.workingDirectory ?? null,
  );
}
