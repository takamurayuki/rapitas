/**
 * GitHub Service Types
 *
 * All exported public types and internal gh CLI JSON shape interfaces
 * used across the GitHub service modules.
 * Not responsible for any API calls or business logic.
 */

export type PullRequest = {
  number: number;
  title: string;
  body: string | null;
  state: string;
  headBranch: string;
  baseBranch: string;
  authorLogin: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  mergeable?: boolean;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
};

export type PullRequestReview = {
  id: number;
  state: string;
  body: string | null;
  authorLogin: string;
  submittedAt: string;
};

export type PullRequestComment = {
  id: number;
  body: string;
  path?: string;
  line?: number;
  authorLogin: string;
  createdAt: string;
};

export type Issue = {
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: string[];
  authorLogin: string;
  url: string;
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

export type CreateIssueInput = {
  title: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
};

export type CreatePRCommentInput = {
  body: string;
  path?: string;
  line?: number;
  side?: 'LEFT' | 'RIGHT';
  commitId?: string;
};

// ==================== gh CLI JSON output types ====================

export interface GhPullRequest {
  number: number;
  title: string;
  body: string | null;
  state: string;
  headRefName: string;
  baseRefName: string;
  author?: { login: string };
  url: string;
  createdAt: string;
  updatedAt: string;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  mergeable?: boolean;
}

export interface GhFileDiff {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface GhReview {
  id: number;
  state: string;
  body: string | null;
  user?: { login: string };
  submitted_at: string;
}

export interface GhComment {
  id: number;
  body: string;
  path?: string;
  line?: number;
  original_line?: number;
  user?: { login: string };
  created_at: string;
}

export interface GhIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels?: Array<{ name: string }>;
  author?: { login: string };
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface GhLabel {
  name: string;
}

export interface GitHubWebhookPayload {
  action: string;
  repository: {
    name: string;
    html_url: string;
    owner: { login: string };
  };
  pull_request?: {
    number: number;
    title: string;
    body: string | null;
    state: string;
    head: { ref: string };
    base: { ref: string };
    user: { login: string };
    html_url: string;
  };
  review?: {
    state: string;
    user: { login: string };
  };
  comment?: {
    body: string;
    user: { login: string };
  };
  issue?: {
    number: number;
    title: string;
    body: string | null;
    state: string;
    labels: Array<{ name: string }>;
    user: { login: string };
    html_url: string;
  };
}
