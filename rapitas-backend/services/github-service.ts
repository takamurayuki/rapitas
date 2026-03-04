/**
 * GitHub連携サービス
 * gh CLI を使用してGitHub操作を行う
 */

import { exec } from "child_process";
import { promisify } from "util";
import { PrismaClient } from '@prisma/client';
type PrismaClientInstance = InstanceType<typeof PrismaClient>;
import { realtimeService } from "./realtime-service";

const execAsync = promisify(exec);

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
  side?: "LEFT" | "RIGHT";
  commitId?: string;
};

// ==================== gh CLI JSON output types ====================

interface GhPullRequest {
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

interface GhFileDiff {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

interface GhReview {
  id: number;
  state: string;
  body: string | null;
  user?: { login: string };
  submitted_at: string;
}

interface GhComment {
  id: number;
  body: string;
  path?: string;
  line?: number;
  original_line?: number;
  user?: { login: string };
  created_at: string;
}

interface GhIssue {
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

interface GhLabel {
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

/**
 * GitHub Service クラス
 */
export class GitHubService {
  private prisma: PrismaClientInstance;

  constructor(prisma: PrismaClientInstance) {
    this.prisma = prisma;
  }

  /**
   * gh CLI コマンドを実行
   */
  private async runGhCommand(args: string[], cwd?: string): Promise<string> {
    // Windows環境でのghコマンドのフルパス
    const ghPath =
      process.platform === "win32"
        ? '"C:\\Program Files\\GitHub CLI\\gh.exe"'
        : "gh";
    const command = `${ghPath} ${args.join(" ")}`;
    try {
      const { stdout } = await execAsync(command, {
        cwd,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });
      return stdout.trim();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stderr = error && typeof error === 'object' && 'stderr' in error ? (error as { stderr: string }).stderr : undefined;
      console.error(`gh command failed: ${command}`, message);
      throw new Error(stderr || message);
    }
  }

  /**
   * gh CLI が利用可能か確認
   */
  async isGhAvailable(): Promise<boolean> {
    try {
      await this.runGhCommand(["--version"]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * gh CLI の認証状態を確認
   */
  async isAuthenticated(): Promise<boolean> {
    try {
      await this.runGhCommand(["auth", "status"]);
      return true;
    } catch {
      return false;
    }
  }

  // ==================== Pull Request 操作 ====================

  /**
   * PRリストを取得
   */
  async getPullRequests(
    repo: string,
    state: "open" | "closed" | "all" = "open",
    limit: number = 30,
  ): Promise<PullRequest[]> {
    const output = await this.runGhCommand([
      "pr",
      "list",
      "--repo",
      repo,
      "--state",
      state,
      "--limit",
      String(limit),
      "--json",
      "number,title,body,state,headRefName,baseRefName,author,url,createdAt,updatedAt,additions,deletions,changedFiles",
    ]);

    if (!output) return [];

    const prs = JSON.parse(output);
    return prs.map((pr: GhPullRequest) => ({
      number: pr.number,
      title: pr.title,
      body: pr.body,
      state: pr.state,
      headBranch: pr.headRefName,
      baseBranch: pr.baseRefName,
      authorLogin: pr.author?.login || "unknown",
      url: pr.url,
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
      additions: pr.additions,
      deletions: pr.deletions,
      changedFiles: pr.changedFiles,
    }));
  }

  /**
   * PR詳細を取得
   */
  async getPullRequest(
    repo: string,
    prNumber: number,
  ): Promise<PullRequest | null> {
    try {
      const output = await this.runGhCommand([
        "pr",
        "view",
        String(prNumber),
        "--repo",
        repo,
        "--json",
        "number,title,body,state,headRefName,baseRefName,author,url,createdAt,updatedAt,mergeable,additions,deletions,changedFiles",
      ]);

      const pr = JSON.parse(output);
      return {
        number: pr.number,
        title: pr.title,
        body: pr.body,
        state: pr.state,
        headBranch: pr.headRefName,
        baseBranch: pr.baseRefName,
        authorLogin: pr.author?.login || "unknown",
        url: pr.url,
        createdAt: pr.createdAt,
        updatedAt: pr.updatedAt,
        mergeable: pr.mergeable,
        additions: pr.additions,
        deletions: pr.deletions,
        changedFiles: pr.changedFiles,
      };
    } catch {
      return null;
    }
  }

  /**
   * PRの差分を取得
   */
  async getPullRequestDiff(
    repo: string,
    prNumber: number,
  ): Promise<FileDiff[]> {
    const output = await this.runGhCommand([
      "api",
      `repos/${repo}/pulls/${prNumber}/files`,
      "--jq",
      ".[].filename, .[].status, .[].additions, .[].deletions, .[].patch",
    ]);

    // gh api はJSONで取得
    const filesOutput = await this.runGhCommand([
      "api",
      `repos/${repo}/pulls/${prNumber}/files`,
    ]);

    const files = JSON.parse(filesOutput);
    return files.map((file: GhFileDiff) => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      patch: file.patch,
    }));
  }

  /**
   * PRのレビューを取得
   */
  async getPullRequestReviews(
    repo: string,
    prNumber: number,
  ): Promise<PullRequestReview[]> {
    const output = await this.runGhCommand([
      "api",
      `repos/${repo}/pulls/${prNumber}/reviews`,
    ]);

    const reviews = JSON.parse(output);
    return reviews.map((review: GhReview) => ({
      id: review.id,
      state: review.state,
      body: review.body,
      authorLogin: review.user?.login || "unknown",
      submittedAt: review.submitted_at,
    }));
  }

  /**
   * PRのコメントを取得
   */
  async getPullRequestComments(
    repo: string,
    prNumber: number,
  ): Promise<PullRequestComment[]> {
    const output = await this.runGhCommand([
      "api",
      `repos/${repo}/pulls/${prNumber}/comments`,
    ]);

    const comments = JSON.parse(output);
    return comments.map((comment: GhComment) => ({
      id: comment.id,
      body: comment.body,
      path: comment.path,
      line: comment.line || comment.original_line,
      authorLogin: comment.user?.login || "unknown",
      createdAt: comment.created_at,
    }));
  }

  /**
   * PRにコメントを投稿
   */
  async createPullRequestComment(
    repo: string,
    prNumber: number,
    input: CreatePRCommentInput,
  ): Promise<PullRequestComment> {
    if (input.path && input.line) {
      // レビューコメント（特定ファイル・行に対するコメント）
      const output = await this.runGhCommand([
        "api",
        `repos/${repo}/pulls/${prNumber}/comments`,
        "-f",
        `body=${input.body}`,
        "-f",
        `path=${input.path}`,
        "-F",
        `line=${input.line}`,
        ...(input.side ? ["-f", `side=${input.side}`] : []),
        ...(input.commitId ? ["-f", `commit_id=${input.commitId}`] : []),
      ]);

      const comment = JSON.parse(output);
      return {
        id: comment.id,
        body: comment.body,
        path: comment.path,
        line: comment.line,
        authorLogin: comment.user?.login || "unknown",
        createdAt: comment.created_at,
      };
    } else {
      // 一般コメント（Issue comment）
      const output = await this.runGhCommand([
        "pr",
        "comment",
        String(prNumber),
        "--repo",
        repo,
        "--body",
        input.body,
      ]);

      return {
        id: 0, // gh pr comment は ID を返さない
        body: input.body,
        authorLogin: "rapitas",
        createdAt: new Date().toISOString(),
      };
    }
  }

  /**
   * PRを承認
   */
  async approvePullRequest(
    repo: string,
    prNumber: number,
    body?: string,
  ): Promise<void> {
    const args = [
      "pr",
      "review",
      String(prNumber),
      "--repo",
      repo,
      "--approve",
    ];
    if (body) {
      args.push("--body", body);
    }
    await this.runGhCommand(args);
  }

  /**
   * PRに変更をリクエスト
   */
  async requestChanges(
    repo: string,
    prNumber: number,
    body: string,
  ): Promise<void> {
    await this.runGhCommand([
      "pr",
      "review",
      String(prNumber),
      "--repo",
      repo,
      "--request-changes",
      "--body",
      body,
    ]);
  }

  /**
   * 作業ディレクトリからPRを作成
   */
  async createPullRequest(
    workingDirectory: string,
    headBranch: string,
    baseBranch: string,
    title: string,
    body: string,
  ): Promise<{
    prNumber?: number;
    prUrl?: string;
    success: boolean;
    error?: string;
  }> {
    try {
      // 現在のブランチをプッシュ
      await execAsync(`git push -u origin ${headBranch}`, {
        cwd: workingDirectory,
      });

      // PRを作成
      const output = await this.runGhCommand(
        [
          "pr",
          "create",
          "--title",
          title,
          "--body",
          body,
          "--base",
          baseBranch,
          "--head",
          headBranch,
        ],
        workingDirectory,
      );

      // PR URLからPR番号を抽出
      const prUrl = output.trim();
      const prMatch = prUrl.match(/\/pull\/(\d+)/);
      const prNumber = prMatch ? parseInt(prMatch[1], 10) : undefined;

      return { success: true, prUrl, prNumber };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Failed to create PR:", error);
      return { success: false, error: message };
    }
  }

  // ==================== Issue 操作 ====================

  /**
   * Issueリストを取得
   */
  async getIssues(
    repo: string,
    state: "open" | "closed" | "all" = "open",
    limit: number = 30,
  ): Promise<Issue[]> {
    const output = await this.runGhCommand([
      "issue",
      "list",
      "--repo",
      repo,
      "--state",
      state,
      "--limit",
      String(limit),
      "--json",
      "number,title,body,state,labels,author,url,createdAt,updatedAt",
    ]);

    if (!output) return [];

    const issues = JSON.parse(output);
    return issues.map((issue: GhIssue) => ({
      number: issue.number,
      title: issue.title,
      body: issue.body,
      state: issue.state,
      labels: issue.labels?.map((l: GhLabel) => l.name) || [],
      authorLogin: issue.author?.login || "unknown",
      url: issue.url,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
    }));
  }

  /**
   * Issue詳細を取得
   */
  async getIssue(repo: string, issueNumber: number): Promise<Issue | null> {
    try {
      const output = await this.runGhCommand([
        "issue",
        "view",
        String(issueNumber),
        "--repo",
        repo,
        "--json",
        "number,title,body,state,labels,author,url,createdAt,updatedAt",
      ]);

      const issue = JSON.parse(output);
      return {
        number: issue.number,
        title: issue.title,
        body: issue.body,
        state: issue.state,
        labels: issue.labels?.map((l: GhLabel) => l.name) || [],
        authorLogin: issue.author?.login || "unknown",
        url: issue.url,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
      };
    } catch {
      return null;
    }
  }

  /**
   * Issueを作成
   */
  async createIssue(repo: string, input: CreateIssueInput): Promise<Issue> {
    const args = ["issue", "create", "--repo", repo, "--title", input.title];

    if (input.body) {
      args.push("--body", input.body);
    }
    if (input.labels && input.labels.length > 0) {
      args.push("--label", input.labels.join(","));
    }
    if (input.assignees && input.assignees.length > 0) {
      args.push("--assignee", input.assignees.join(","));
    }

    // URL を取得
    const url = await this.runGhCommand(args);

    // 作成されたIssueの番号を抽出
    const match = url.match(/\/issues\/(\d+)/);
    if (!match) {
      throw new Error("Failed to parse created issue URL");
    }

    const issueNumber = parseInt(match[1], 10);
    const issue = await this.getIssue(repo, issueNumber);
    if (!issue) {
      throw new Error("Failed to fetch created issue");
    }

    return issue;
  }

  /**
   * Issueにコメントを追加
   */
  async addIssueComment(
    repo: string,
    issueNumber: number,
    body: string,
  ): Promise<{ id: number; body: string }> {
    await this.runGhCommand([
      "issue",
      "comment",
      String(issueNumber),
      "--repo",
      repo,
      "--body",
      body,
    ]);

    return {
      id: 0, // gh issue comment は ID を返さない
      body,
    };
  }

  // ==================== 同期機能 ====================

  /**
   * PRを同期
   */
  async syncPullRequests(integrationId: number): Promise<number> {
    const integration = await this.prisma.gitHubIntegration.findUnique({
      where: { id: integrationId },
    });

    if (!integration) {
      throw new Error("Integration not found");
    }

    const repo = `${integration.ownerName}/${integration.repositoryName}`;
    const prs = await this.getPullRequests(repo, "all", 100);

    let syncedCount = 0;
    for (const pr of prs) {
      await this.prisma.gitHubPullRequest.upsert({
        where: {
          integrationId_prNumber: {
            integrationId,
            prNumber: pr.number,
          },
        },
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

    // 同期完了通知を送信
    realtimeService.sendGitHubEvent("pr_sync_complete", {
      integrationId,
      syncedCount,
      timestamp: new Date().toISOString(),
    });

    return syncedCount;
  }

  /**
   * Issueを同期
   */
  async syncIssues(integrationId: number): Promise<number> {
    const integration = await this.prisma.gitHubIntegration.findUnique({
      where: { id: integrationId },
    });

    if (!integration) {
      throw new Error("Integration not found");
    }

    const repo = `${integration.ownerName}/${integration.repositoryName}`;
    const issues = await this.getIssues(repo, "all", 100);

    let syncedCount = 0;
    for (const issue of issues) {
      await this.prisma.gitHubIssue.upsert({
        where: {
          integrationId_issueNumber: {
            integrationId,
            issueNumber: issue.number,
          },
        },
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

    // 同期完了通知を送信
    realtimeService.sendGitHubEvent("issue_sync_complete", {
      integrationId,
      syncedCount,
      timestamp: new Date().toISOString(),
    });

    return syncedCount;
  }

  // ==================== Webhook 処理 ====================

  /**
   * Webhookイベントを処理
   */
  async handleWebhook(event: string, payload: GitHubWebhookPayload): Promise<void> {
    switch (event) {
      case "pull_request":
        await this.handlePullRequestEvent(payload);
        break;
      case "pull_request_review":
        await this.handlePullRequestReviewEvent(payload);
        break;
      case "issue_comment":
      case "pull_request_review_comment":
        await this.handleCommentEvent(event, payload);
        break;
      case "issues":
        await this.handleIssueEvent(payload);
        break;
      default:
        console.log(`Unhandled webhook event: ${event}`);
    }
  }

  private async handlePullRequestEvent(payload: GitHubWebhookPayload): Promise<void> {
    if (!payload.pull_request) return;
    const { action, pull_request, repository } = payload;
    const repo = `${repository.owner.login}/${repository.name}`;

    // リアルタイム通知
    realtimeService.sendGitHubEvent("pull_request", {
      action,
      prNumber: pull_request.number,
      title: pull_request.title,
      repo,
      timestamp: new Date().toISOString(),
    });

    // DBを更新
    const integration = await this.prisma.gitHubIntegration.findFirst({
      where: { repositoryUrl: repository.html_url },
    });

    if (integration && integration.syncPullRequests) {
      await this.prisma.gitHubPullRequest.upsert({
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

  private async handlePullRequestReviewEvent(payload: GitHubWebhookPayload): Promise<void> {
    if (!payload.pull_request || !payload.review) return;
    const { action, review, pull_request, repository } = payload;
    const repo = `${repository.owner.login}/${repository.name}`;

    // リアルタイム通知
    realtimeService.sendGitHubEvent("pull_request_review", {
      action,
      prNumber: pull_request.number,
      reviewState: review.state,
      reviewer: review.user.login,
      repo,
      timestamp: new Date().toISOString(),
    });

    // 通知を作成（レビューリクエスト時など）
    if (action === "submitted") {
      await this.prisma.notification.create({
        data: {
          type:
            review.state === "approved"
              ? "pr_approved"
              : "pr_changes_requested",
          title: review.state === "approved" ? "PR承認" : "PR変更リクエスト",
          message: `${review.user.login}が PR #${pull_request.number} を${review.state === "approved" ? "承認" : "レビュー"}しました`,
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

  private async handleCommentEvent(event: string, payload: GitHubWebhookPayload): Promise<void> {
    if (!payload.comment) return;
    const { action, comment, issue, pull_request, repository } = payload;
    const repo = `${repository.owner.login}/${repository.name}`;
    const number = pull_request?.number || issue?.number;

    // リアルタイム通知
    realtimeService.sendGitHubEvent(event, {
      action,
      number,
      commentBody: comment.body.substring(0, 100),
      author: comment.user.login,
      repo,
      timestamp: new Date().toISOString(),
    });
  }

  private async handleIssueEvent(payload: GitHubWebhookPayload): Promise<void> {
    if (!payload.issue) return;
    const { action, issue, repository } = payload;
    const repo = `${repository.owner.login}/${repository.name}`;

    // リアルタイム通知
    realtimeService.sendGitHubEvent("issue", {
      action,
      issueNumber: issue.number,
      title: issue.title,
      repo,
      timestamp: new Date().toISOString(),
    });

    // DBを更新
    const integration = await this.prisma.gitHubIntegration.findFirst({
      where: { repositoryUrl: repository.html_url },
    });

    if (integration && integration.syncIssues) {
      await this.prisma.gitHubIssue.upsert({
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
}
