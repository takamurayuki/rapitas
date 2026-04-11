/**
 * GitHub Integration Service
 *
 * Backward-compatible re-export facade for the GitHub service modules.
 * All logic lives in services/github/*.ts; this file preserves the original
 * import path so existing consumers do not need to change.
 * Not responsible for any direct gh CLI calls or database access.
 */

import { PrismaClient } from '@prisma/client';
import { isGhAvailable, isAuthenticated } from '../github/gh-client';
import {
  getPullRequests,
  getPullRequest,
  getPullRequestDiff,
  getPullRequestReviews,
  getPullRequestComments,
  createPullRequestComment,
  approvePullRequest,
  requestChanges,
  createPullRequest,
} from '../github/pr-operations';
import { getIssues, getIssue, createIssue, addIssueComment } from '../github/issue-operations';
import { syncPullRequests, syncIssues, handleWebhook } from '../github/sync-webhook';

// Re-export all public types so consumers can import from the original path
export type {
  PullRequest,
  PullRequestReview,
  PullRequestComment,
  Issue,
  FileDiff,
  CreateIssueInput,
  CreatePRCommentInput,
  GitHubWebhookPayload,
} from '../github/types';

type PrismaClientInstance = InstanceType<typeof PrismaClient>;

/**
 * GitHub Service class
 *
 * Thin class wrapper providing instance-based access to the GitHub module functions.
 * Accepts a Prisma instance at construction for database-backed operations.
 */
export class GitHubService {
  private prisma: PrismaClientInstance;

  constructor(prisma: PrismaClientInstance) {
    this.prisma = prisma;
  }

  // ==================== CLI availability ====================

  /** Check if gh CLI is available / ghが利用可能かどうか */
  async isGhAvailable(): Promise<boolean> {
    return isGhAvailable();
  }

  /** Check gh CLI authentication status / 認証状態を確認する */
  async isAuthenticated(): Promise<boolean> {
    return isAuthenticated();
  }

  // ==================== Pull Request Operations ====================

  /** @see pr-operations.getPullRequests */
  async getPullRequests(
    repo: string,
    state: 'open' | 'closed' | 'all' = 'open',
    limit: number = 30,
  ) {
    return getPullRequests(repo, state, limit);
  }

  /** @see pr-operations.getPullRequest */
  async getPullRequest(repo: string, prNumber: number) {
    return getPullRequest(repo, prNumber);
  }

  /** @see pr-operations.getPullRequestDiff */
  async getPullRequestDiff(repo: string, prNumber: number) {
    return getPullRequestDiff(repo, prNumber);
  }

  /** @see pr-operations.getPullRequestReviews */
  async getPullRequestReviews(repo: string, prNumber: number) {
    return getPullRequestReviews(repo, prNumber);
  }

  /** @see pr-operations.getPullRequestComments */
  async getPullRequestComments(repo: string, prNumber: number) {
    return getPullRequestComments(repo, prNumber);
  }

  /** @see pr-operations.createPullRequestComment */
  async createPullRequestComment(
    repo: string,
    prNumber: number,
    input: Parameters<typeof createPullRequestComment>[2],
  ) {
    return createPullRequestComment(repo, prNumber, input);
  }

  /** @see pr-operations.approvePullRequest */
  async approvePullRequest(repo: string, prNumber: number, body?: string) {
    return approvePullRequest(repo, prNumber, body);
  }

  /** @see pr-operations.requestChanges */
  async requestChanges(repo: string, prNumber: number, body: string) {
    return requestChanges(repo, prNumber, body);
  }

  /** @see pr-operations.createPullRequest */
  async createPullRequest(
    workingDirectory: string,
    headBranch: string,
    baseBranch: string,
    title: string,
    body: string,
  ) {
    return createPullRequest(workingDirectory, headBranch, baseBranch, title, body);
  }

  // ==================== Issue Operations ====================

  /** @see issue-operations.getIssues */
  async getIssues(repo: string, state: 'open' | 'closed' | 'all' = 'open', limit: number = 30) {
    return getIssues(repo, state, limit);
  }

  /** @see issue-operations.getIssue */
  async getIssue(repo: string, issueNumber: number) {
    return getIssue(repo, issueNumber);
  }

  /** @see issue-operations.createIssue */
  async createIssue(repo: string, input: Parameters<typeof createIssue>[1]) {
    return createIssue(repo, input);
  }

  /** @see issue-operations.addIssueComment */
  async addIssueComment(repo: string, issueNumber: number, body: string) {
    return addIssueComment(repo, issueNumber, body);
  }

  // ==================== Sync Features ====================

  /** @see sync-webhook.syncPullRequests */
  async syncPullRequests(integrationId: number) {
    return syncPullRequests(this.prisma, integrationId);
  }

  /** @see sync-webhook.syncIssues */
  async syncIssues(integrationId: number) {
    return syncIssues(this.prisma, integrationId);
  }

  // ==================== Webhook Handling ====================

  /** @see sync-webhook.handleWebhook */
  async handleWebhook(event: string, payload: Parameters<typeof handleWebhook>[2]) {
    return handleWebhook(this.prisma, event, payload);
  }
}
