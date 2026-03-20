/**
 * GitHub Webhook Event Handlers
 *
 * Private handlers for individual GitHub webhook event types.
 * Called exclusively by sync-webhook.ts handleWebhook dispatcher.
 * Not responsible for route registration, PR/Issue API calls, or sync logic.
 */

import { PrismaClient } from '@prisma/client';
import { createLogger } from '../../config/logger';
import { realtimeService } from '../realtime-service';
import type { GitHubWebhookPayload } from './types';

const log = createLogger('github-service:webhook-handlers');
type PrismaClientInstance = InstanceType<typeof PrismaClient>;

/**
 * Handle pull_request webhook event.
 * Sends a real-time notification and upserts the PR record if sync is enabled.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param payload - Webhook payload / Webhookペイロード
 */
export async function handlePullRequestEvent(
  prisma: PrismaClientInstance,
  payload: GitHubWebhookPayload,
): Promise<void> {
  if (!payload.pull_request) return;
  const { action, pull_request, repository } = payload;
  const repo = `${repository.owner.login}/${repository.name}`;

  realtimeService.sendGitHubEvent('pull_request', {
    action,
    prNumber: pull_request.number,
    title: pull_request.title,
    repo,
    timestamp: new Date().toISOString(),
  });

  const integration = await prisma.gitHubIntegration.findFirst({
    where: { repositoryUrl: repository.html_url },
  });

  if (integration && integration.syncPullRequests) {
    await prisma.gitHubPullRequest.upsert({
      where: {
        integrationId_prNumber: {
          integrationId: integration.id,
          prNumber: pull_request.number,
        },
      },
      update: {
        title: pull_request.title,
        body: pull_request.body,
        state: pull_request.state,
        headBranch: pull_request.head.ref,
        baseBranch: pull_request.base.ref,
        lastSyncedAt: new Date(),
      },
      create: {
        integrationId: integration.id,
        prNumber: pull_request.number,
        title: pull_request.title,
        body: pull_request.body,
        state: pull_request.state,
        headBranch: pull_request.head.ref,
        baseBranch: pull_request.base.ref,
        authorLogin: pull_request.user.login,
        url: pull_request.html_url,
        lastSyncedAt: new Date(),
      },
    });
  }
}

/**
 * Handle pull_request_review webhook event.
 * Sends a real-time notification and creates an in-app notification on submission.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param payload - Webhook payload / Webhookペイロード
 */
export async function handlePullRequestReviewEvent(
  prisma: PrismaClientInstance,
  payload: GitHubWebhookPayload,
): Promise<void> {
  if (!payload.pull_request || !payload.review) return;
  const { action, review, pull_request, repository } = payload;
  const repo = `${repository.owner.login}/${repository.name}`;

  realtimeService.sendGitHubEvent('pull_request_review', {
    action,
    prNumber: pull_request.number,
    reviewState: review.state,
    reviewer: review.user.login,
    repo,
    timestamp: new Date().toISOString(),
  });

  if (action === 'submitted') {
    await prisma.notification.create({
      data: {
        type: review.state === 'approved' ? 'pr_approved' : 'pr_changes_requested',
        title: review.state === 'approved' ? 'PR承認' : 'PR変更リクエスト',
        message: `${review.user.login}が PR #${pull_request.number} を${review.state === 'approved' ? '承認' : 'レビュー'}しました`,
        link: pull_request.html_url,
        metadata: JSON.stringify({
          prNumber: pull_request.number,
          repo,
          reviewer: review.user.login,
        }),
      },
    });
  }
}

/**
 * Handle issue_comment and pull_request_review_comment webhook events.
 * Sends a real-time notification only.
 *
 * @param event - Webhook event name / イベント名
 * @param payload - Webhook payload / Webhookペイロード
 */
export async function handleCommentEvent(
  event: string,
  payload: GitHubWebhookPayload,
): Promise<void> {
  if (!payload.comment) return;
  const { action, comment, issue, pull_request, repository } = payload;
  const repo = `${repository.owner.login}/${repository.name}`;
  const number = pull_request?.number || issue?.number;

  realtimeService.sendGitHubEvent(event, {
    action,
    number,
    commentBody: comment.body.substring(0, 100),
    author: comment.user.login,
    repo,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Handle issues webhook event.
 * Sends a real-time notification and upserts the issue record if sync is enabled.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param payload - Webhook payload / Webhookペイロード
 */
export async function handleIssueEvent(
  prisma: PrismaClientInstance,
  payload: GitHubWebhookPayload,
): Promise<void> {
  if (!payload.issue) return;
  const { action, issue, repository } = payload;
  const repo = `${repository.owner.login}/${repository.name}`;

  realtimeService.sendGitHubEvent('issue', {
    action,
    issueNumber: issue.number,
    title: issue.title,
    repo,
    timestamp: new Date().toISOString(),
  });

  const integration = await prisma.gitHubIntegration.findFirst({
    where: { repositoryUrl: repository.html_url },
  });

  if (integration && integration.syncIssues) {
    await prisma.gitHubIssue.upsert({
      where: {
        integrationId_issueNumber: {
          integrationId: integration.id,
          issueNumber: issue.number,
        },
      },
      update: {
        title: issue.title,
        body: issue.body,
        state: issue.state,
        labels: JSON.stringify(issue.labels.map((l: { name: string }) => l.name)),
        lastSyncedAt: new Date(),
      },
      create: {
        integrationId: integration.id,
        issueNumber: issue.number,
        title: issue.title,
        body: issue.body,
        state: issue.state,
        labels: JSON.stringify(issue.labels.map((l: { name: string }) => l.name)),
        authorLogin: issue.user.login,
        url: issue.html_url,
        lastSyncedAt: new Date(),
      },
    });
  }
}
