/**
 * Manual PR Registration
 *
 * Registers a PR an operator opened by hand (e.g. after auto-PR failed on a merge
 * conflict) as a local GitHubPullRequest row and links it to its task, so
 * `findLandedPullRequest` sees it. Unlike `linkAutoCreatedPr` this is NOT
 * best-effort: every refusal is reported with a reason. It never provisions an
 * integration — an unknown repository is a rejection, not an implicit create.
 */
import type { PrismaClient } from '../../generated/prisma-postgres';
import { parseOwnerRepo, makeOwnerRepoString } from './owner-repo';
import type { OwnerRepoString } from './owner-repo';
import { resolveIntegrationIdForTask } from './pr-lookup';
import { verifyPrOwnership } from './pr-ownership';
import { updateTaskPublicationMetadata } from './task-publication-metadata';

/** Minimal PR shape needed from GitHub. / GitHubから必要なPR情報 */
export interface FetchedPr {
  number: number;
  title: string;
  body?: string | null;
  state: string;
  headBranch: string;
  baseBranch: string;
  authorLogin: string;
  url: string;
}

/** Fetches a PR from GitHub; null when it does not exist. / GitHubからPRを取得する */
export type FetchPr = (repo: OwnerRepoString, prNumber: number) => Promise<FetchedPr | null>;

export type RegisterManualPrResult =
  | { ok: true; localPrId: number; prNumber: number; state: string }
  | {
      ok: false;
      status: 400 | 404 | 409 | 422;
      reason:
        | 'invalid_repo'
        | 'task_not_found'
        | 'integration_not_found'
        | 'task_repo_unresolved'
        | 'repo_mismatch'
        | 'pr_not_found'
        | 'pr_closed'
        | 'linked_to_other_task'
        | 'marker_mismatch'
        | 'task_changed';
    };

/**
 * Validate and register a hand-made PR against a task.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param fetchPr - GitHub PR fetcher / PR取得関数
 * @param params - Task id, PR number and `owner/repo` / タスクID・PR番号・owner/repo
 * @returns Registered local row id, or a rejection with HTTP status and reason / 登録結果または拒否理由
 */
export async function registerManualPr(
  prisma: PrismaClient,
  fetchPr: FetchPr,
  params: { taskId: number; prNumber: number; repo: string },
): Promise<RegisterManualPrResult> {
  const { taskId, prNumber } = params;
  const ident = /^[\w.-]+\/[\w.-]+$/.test(params.repo)
    ? parseOwnerRepo(`https://github.com/${params.repo}`)
    : null;
  if (!ident) return { ok: false, status: 400, reason: 'invalid_repo' };

  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true } });
  if (!task) return { ok: false, status: 404, reason: 'task_not_found' };

  // Exact owner/repo match only — pickIntegrationId's sole-integration fallback
  // would let a different repository's PR number through.
  const integrations = await prisma.gitHubIntegration.findMany({
    select: { id: true, ownerName: true, repositoryName: true },
  });
  const integration = integrations.find(
    (i) =>
      i.ownerName.toLowerCase() === ident.owner && i.repositoryName.toLowerCase() === ident.repo,
  );
  if (!integration) return { ok: false, status: 404, reason: 'integration_not_found' };

  const taskIntegrationId = await resolveIntegrationIdForTask(prisma, taskId);
  if (taskIntegrationId == null) return { ok: false, status: 422, reason: 'task_repo_unresolved' };
  if (taskIntegrationId !== integration.id) {
    return { ok: false, status: 409, reason: 'repo_mismatch' };
  }

  const pr = await fetchPr(makeOwnerRepoString(ident.owner, ident.repo), prNumber);
  if (!pr || pr.number !== prNumber) return { ok: false, status: 404, reason: 'pr_not_found' };

  const state = pr.state.toLowerCase();
  // A closed-unmerged PR carries no work; linking it would pass the PR gate falsely.
  if (state === 'closed') return { ok: false, status: 409, reason: 'pr_closed' };

  const existing = await prisma.gitHubPullRequest.findUnique({
    where: { integrationId_prNumber: { integrationId: integration.id, prNumber } },
    select: { linkedTaskId: true },
  });
  if (existing?.linkedTaskId != null && existing.linkedTaskId !== taskId) {
    return { ok: false, status: 409, reason: 'linked_to_other_task' };
  }
  // An operator's explicit action may claim a marker-less PR (no_marker), but a
  // marker naming another task is still a refusal.
  const verdict = verifyPrOwnership(
    { linkedTaskId: existing?.linkedTaskId ?? null, title: pr.title, body: pr.body },
    taskId,
  );
  if (!verdict.canClaim && verdict.reason !== 'no_marker') {
    return { ok: false, status: 409, reason: 'marker_mismatch' };
  }

  const now = new Date();
  const row = await prisma.gitHubPullRequest.upsert({
    where: { integrationId_prNumber: { integrationId: integration.id, prNumber } },
    update: { linkedTaskId: taskId, state, lastSyncedAt: now },
    create: {
      integrationId: integration.id,
      prNumber,
      title: pr.title,
      body: pr.body ?? null,
      state,
      headBranch: pr.headBranch,
      baseBranch: pr.baseBranch,
      authorLogin: pr.authorLogin,
      url: pr.url,
      linkedTaskId: taskId,
      lastSyncedAt: now,
    },
    select: { id: true },
  });

  if (!(await updateTaskPublicationMetadata(prisma, taskId, { githubPrId: prNumber }))) {
    return { ok: false, status: 409, reason: 'task_changed' };
  }
  return { ok: true, localPrId: row.id, prNumber, state };
}
