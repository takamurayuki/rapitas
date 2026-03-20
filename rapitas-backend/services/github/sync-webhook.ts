/**
 * GitHub Sync and Webhook Dispatcher
 *
 * Handles periodic sync of pull requests and issues to the database,
 * and dispatches incoming GitHub webhook events to type-specific handlers
 * in webhook-handlers.ts.
 * Not responsible for gh CLI calls — delegates to pr-operations and issue-operations.
 */

import { PrismaClient } from '@prisma/client';
import { createLogger } from '../../config/logger';
import { realtimeService } from '../realtime-service';
import { getPullRequests } from './pr-operations';
import { getIssues } from './issue-operations';
import {
  handlePullRequestEvent,
  handlePullRequestReviewEvent,
  handleCommentEvent,
  handleIssueEvent,
} from './webhook-handlers';
import type { GitHubWebhookPayload } from './types';

const log = createLogger('github-service:sync-webhook');
type PrismaClientInstance = InstanceType<typeof PrismaClient>;

/**
 * Sync all open/closed pull requests for an integration to the database.
 *
 * @param prisma - Prisma client instance / Prismaクライアント
 * @param integrationId - GitHub integration record ID / 統合レコードID
 * @returns Count of synced PRs / 同期されたPR数
 * @throws {Error} When integration is not found
 */
export async function syncPullRequests(
  prisma: PrismaClientInstance,
  integrationId: number,
): Promise<number> {
  const integration = await prisma.gitHubIntegration.findUnique({
    where: { id: integrationId },
  });

  if (!integration) {
    throw new Error('Integration not found');
  }

  const repo = `${integration.ownerName}/${integration.repositoryName}`;
  const prs = await getPullRequests(repo, 'all', 100);

  let syncedCount = 0;
  for (const pr of prs) {
    await prisma.gitHubPullRequest.upsert({
      where: { integrationId_prNumber: { integrationId, prNumber: pr.number } },
      update: {
        title: pr.title,
        body: pr.body,
        state: pr.state,
        headBranch: pr.headBranch,
        baseBranch: pr.baseBranch,
        authorLogin: pr.authorLogin,
        url: pr.url,
        lastSyncedAt: new Date(),
      },
      create: {
        integrationId,
        prNumber: pr.number,
        title: pr.title,
        body: pr.body,
        state: pr.state,
        headBranch: pr.headBranch,
        baseBranch: pr.baseBranch,
        authorLogin: pr.authorLogin,
        url: pr.url,
        lastSyncedAt: new Date(),
      },
    });
    syncedCount++;
  }

  realtimeService.sendGitHubEvent('pr_sync_complete', {
    integrationId,
    syncedCount,
    timestamp: new Date().toISOString(),
  });

  return syncedCount;
}

/**
 * Sync all open/closed issues for an integration to the database.
 *
 * @param prisma - Prisma client instance / Prismaクライアント
 * @param integrationId - GitHub integration record ID / 統合レコードID
 * @returns Count of synced issues / 同期されたイシュー数
 * @throws {Error} When integration is not found
 */
export async function syncIssues(
  prisma: PrismaClientInstance,
  integrationId: number,
): Promise<number> {
  const integration = await prisma.gitHubIntegration.findUnique({
    where: { id: integrationId },
  });

  if (!integration) {
    throw new Error('Integration not found');
  }

  const repo = `${integration.ownerName}/${integration.repositoryName}`;
  const issues = await getIssues(repo, 'all', 100);

  let syncedCount = 0;
  for (const issue of issues) {
    await prisma.gitHubIssue.upsert({
      where: { integrationId_issueNumber: { integrationId, issueNumber: issue.number } },
      update: {
        title: issue.title,
        body: issue.body,
        state: issue.state,
        labels: JSON.stringify(issue.labels),
        authorLogin: issue.authorLogin,
        url: issue.url,
        lastSyncedAt: new Date(),
      },
      create: {
        integrationId,
        issueNumber: issue.number,
        title: issue.title,
        body: issue.body,
        state: issue.state,
        labels: JSON.stringify(issue.labels),
        authorLogin: issue.authorLogin,
        url: issue.url,
        lastSyncedAt: new Date(),
      },
    });
    syncedCount++;
  }

  realtimeService.sendGitHubEvent('issue_sync_complete', {
    integrationId,
    syncedCount,
    timestamp: new Date().toISOString(),
  });

  return syncedCount;
}

/**
 * Dispatch a GitHub webhook event to the appropriate handler.
 *
 * @param prisma - Prisma client instance / Prismaクライアント
 * @param event - Webhook event name / Webhookイベント名
 * @param payload - Parsed webhook payload / Webhookペイロード
 */
export async function handleWebhook(
  prisma: PrismaClientInstance,
  event: string,
  payload: GitHubWebhookPayload,
): Promise<void> {
  switch (event) {
    case 'pull_request':
      await handlePullRequestEvent(prisma, payload);
      break;
    case 'pull_request_review':
      await handlePullRequestReviewEvent(prisma, payload);
      break;
    case 'issue_comment':
    case 'pull_request_review_comment':
      await handleCommentEvent(event, payload);
      break;
    case 'issues':
      await handleIssueEvent(prisma, payload);
      break;
    default:
      log.info(`Unhandled webhook event: ${event}`);
  }
}
