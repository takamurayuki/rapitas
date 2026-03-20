/**
 * github.types
 *
 * Type definitions for GitHub integration entities: integrations, pull requests, reviews,
 * comments, issues, file diffs, screenshots, and code review comments.
 */

export type GitCommit = {
  id: number;
  executionId: number;
  commitHash: string;
  message: string;
  branch: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  createdAt: string;
};

export type GitHubIntegration = {
  id: number;
  repositoryUrl: string;
  repositoryName: string;
  ownerName: string;
  isActive: boolean;
  syncIssues: boolean;
  syncPullRequests: boolean;
  autoLinkTasks: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: {
    pullRequests: number;
    issues: number;
  };
};

export type GitHubPullRequest = {
  id: number;
  integrationId: number;
  integration?: GitHubIntegration;
  prNumber: number;
  title: string;
  body?: string | null;
  state: 'open' | 'closed' | 'merged';
  headBranch: string;
  baseBranch: string;
  authorLogin: string;
  url: string;
  linkedTaskId?: number | null;
  lastSyncedAt: string;
  createdAt: string;
  updatedAt: string;
  reviews?: GitHubPRReview[];
  comments?: GitHubPRComment[];
  _count?: {
    reviews: number;
    comments: number;
  };
};

export type GitHubPRReview = {
  id: number;
  pullRequestId: number;
  reviewId: number;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'PENDING';
  body?: string | null;
  authorLogin: string;
  submittedAt: string;
  createdAt: string;
};

export type GitHubPRComment = {
  id: number;
  pullRequestId: number;
  commentId: number;
  body: string;
  path?: string | null;
  line?: number | null;
  authorLogin: string;
  isFromRapitas: boolean;
  createdAt: string;
  updatedAt: string;
};

export type GitHubIssue = {
  id: number;
  integrationId: number;
  integration?: GitHubIntegration;
  issueNumber: number;
  title: string;
  body?: string | null;
  state: 'open' | 'closed';
  labels: string[];
  authorLogin: string;
  url: string;
  linkedTaskId?: number | null;
  lastSyncedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type FileDiff = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
};

export type ScreenshotInfo = {
  id: string;
  filename: string;
  url: string;
  page: string;
  label: string;
  capturedAt: string;
};

export type ReviewComment = {
  id: string;
  file?: string;
  line?: number;
  content: string;
  type: 'comment' | 'change_request' | 'question';
};
