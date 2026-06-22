/**
 * GitHub Pull Request Routes
 *
 * All PR operations: list, detail, diff, comments, approve, request-changes,
 * merge, base-branch change, and conflict resolution.
 * Helper functions (findPrViaGh, resolvePrWorkingDirectory, titleMatchesTask)
 * have been extracted to services/github/pr-task-resolver.ts.
 */
import { Elysia } from 'elysia';
import { prisma } from '../../../config/database';
import { GitHubService } from '../../../services/core/github-service';
import { resolvePrConflicts } from '../../../services/github/conflict-resolver';
import { checkPrActionable } from '../../../services/github/pr-guards';
import { resolvePrOrThrow } from '../../../services/github/resource-guard';
import { findPrViaGh, resolvePrWorkingDirectory } from '../../../services/github/pr-task-resolver';

const githubService = new GitHubService(prisma);

export const pullRequestRoutes = new Elysia()
  // Get PR list
  .get('/integrations/:id/pull-requests', async (context) => {
    const { params, query } = context;
    const { id } = params as { id: string };
    const { state, fromGitHub } = query as { state?: string; fromGitHub?: string };

    if (fromGitHub === 'true') {
      const integration = await prisma.gitHubIntegration.findUnique({
        where: { id: parseInt(id) },
      });
      if (!integration) return [];
      const repo = `${integration.ownerName}/${integration.repositoryName}`;
      return await githubService.getPullRequests(
        repo,
        (state as 'open' | 'closed' | 'all') || 'open',
      );
    }

    // State filter: "closed" includes merged PRs (GitHub treats a merged PR as
    // closed), otherwise the merged majority would be invisible under both the
    // open and closed tabs. "all" applies no filter.
    const stateWhere =
      !state || state === 'all'
        ? {}
        : state === 'closed'
          ? { state: { in: ['closed', 'merged'] } }
          : { state };

    return await prisma.gitHubPullRequest.findMany({
      where: {
        integrationId: parseInt(id),
        ...stateWhere,
      },
      include: {
        _count: { select: { reviews: true, comments: true } },
      },
      // Order by prNumber (monotonic) — a bulk sync stamps every row's updatedAt
      // with ~the same timestamp, so updatedAt can't express real recency.
      orderBy: { prNumber: 'desc' },
    });
  })

  // Get PR details
  .get('/pull-requests/:id', async (context) => {
    const { params } = context;
    const { id } = params as { id: string };
    return await prisma.gitHubPullRequest.findUnique({
      where: { id: parseInt(id) },
      include: {
        integration: true,
        reviews: { orderBy: { submittedAt: 'desc' } },
        comments: { orderBy: { createdAt: 'asc' } },
      },
    });
  })

  // Resolve the PR for a task → its detail-page id. Used by the post-execution
  // panel to jump straight to the task's PR page (replacing the old approval
  // page). Resolution order:
  //   1. Direct GitHubPullRequest.linkedTaskId (set by linkAutoCreatedPr).
  //   2. PR number stored on the task (Task.githubPrId).
  //   3. Title match `[Task-{id}]` — both auto-PR paths title PRs this way, so
  //      this resolves tasks completed BEFORE the linking fix landed, as long as
  //      the PR row exists locally (a GitHub sync has pulled it in). On a hit we
  //      backfill the linkedTaskId/githubPrId links so it is fast (and the PR
  //      still resolves after a title edit) next time.
  .get('/pull-requests/by-task/:taskId', async (context) => {
    const { taskId } = context.params as { taskId: string };
    const tid = parseInt(taskId);
    const select = { id: true, prNumber: true, url: true, state: true } as const;

    let pr = await prisma.gitHubPullRequest.findFirst({
      where: { linkedTaskId: tid },
      orderBy: { createdAt: 'desc' },
      select,
    });
    if (!pr) {
      const task = await prisma.task.findUnique({
        where: { id: tid },
        select: { githubPrId: true },
      });
      if (task?.githubPrId != null) {
        pr = await prisma.gitHubPullRequest.findFirst({
          where: { prNumber: task.githubPrId },
          orderBy: { createdAt: 'desc' },
          select,
        });
      }
    }
    if (!pr) {
      // Match both PR-title conventions: the app's `[Task-{id}]` and the
      // agent's CLAUDE.md `[#{id}]`. Agent-created PRs use the latter and so
      // never went through linkAutoCreatedPr, leaving paths 1/2 empty.
      pr = await prisma.gitHubPullRequest.findFirst({
        where: {
          OR: [{ title: { contains: `[Task-${tid}]` } }, { title: { contains: `[#${tid}]` } }],
        },
        orderBy: { createdAt: 'desc' },
        select,
      });
      // Self-heal: backfill the links so subsequent clicks hit path 1/2.
      // Best-effort — a write failure must not break the navigation.
      if (pr) {
        try {
          await prisma.gitHubPullRequest.update({
            where: { id: pr.id },
            data: { linkedTaskId: tid },
          });
          await prisma.task.update({ where: { id: tid }, data: { githubPrId: pr.prNumber } });
        } catch {
          /* links remain unset; the title fallback still resolves it each time */
        }
      }
    }
    if (!pr) {
      // No local PR row. Distinguish "a PR was created but isn't synced locally"
      // from "no PR was ever created" using the auto_pr_created activity log, so
      // the UI can give an accurate message (and offer the external GitHub URL
      // instead of a dead end).
      context.set.status = 404;
      const prCreatedLog = await prisma.activityLog.findFirst({
        where: { taskId: tid, action: 'auto_pr_created' },
        orderBy: { createdAt: 'desc' },
        select: { metadata: true },
      });
      if (prCreatedLog) {
        let prUrl: string | undefined;
        let prNumber: number | undefined;
        try {
          const meta = JSON.parse(prCreatedLog.metadata ?? '{}') as {
            prUrl?: string;
            prNumber?: number;
          };
          prUrl = meta.prUrl;
          prNumber = meta.prNumber;
        } catch {
          /* malformed metadata — fall back to the generic not-synced message */
        }
        return {
          reason: 'not_synced',
          prUrl,
          prNumber,
          error:
            'PRは作成済みですが、ローカルに同期されていません。GitHub統合ページでPRを同期してください。',
        };
      }
      // Live fallback: the PR may exist on GitHub with no local row/log (e.g. no
      // GitHubIntegration for this repo, or linking failed). Ask gh directly so
      // the button still opens it instead of falsely reporting "not created".
      const live = await findPrViaGh(tid);
      if (live) {
        return {
          reason: 'not_synced',
          prUrl: live.prUrl,
          prNumber: live.prNumber,
          error:
            'PRは作成済みですが、ローカルに同期されていません（このリポジトリのGitHub統合が未登録の可能性）。GitHubで開きます。',
        };
      }
      return { reason: 'not_created', error: 'このタスクのPRはまだ作成されていません。' };
    }
    return pr;
  })

  // Get PR diff
  .get('/pull-requests/:id/diff', async (context) => {
    const { id } = context.params as { id: string };
    const pr = await resolvePrOrThrow(id);

    const repo = `${pr.integration.ownerName}/${pr.integration.repositoryName}`;
    return await githubService.getPullRequestDiff(repo, pr.prNumber);
  })

  // Post PR comment
  .post('/pull-requests/:id/comments', async (context) => {
    const { id } = context.params as { id: string };
    const {
      body: commentBody,
      path,
      line,
    } = context.body as { body: string; path?: string; line?: number };

    const pr = await resolvePrOrThrow(id);

    const commentGuard = checkPrActionable(pr, {
      operationLabel: 'コメント投稿',
      requireOpen: false,
    });
    if (commentGuard) {
      context.set.status = commentGuard.status;
      return commentGuard.body;
    }

    const repo = `${pr.integration.ownerName}/${pr.integration.repositoryName}`;
    const comment = await githubService.createPullRequestComment(repo, pr.prNumber, {
      body: commentBody,
      path,
      line,
    });

    // Save comment to DB
    await prisma.gitHubPRComment.create({
      data: {
        pullRequestId: pr.id,
        commentId: comment.id || 0,
        body: commentBody,
        path,
        line,
        authorLogin: 'rapitas',
        isFromRapitas: true,
      },
    });

    return comment;
  })

  // Approve PR
  .post('/pull-requests/:id/approve', async (context) => {
    const { id } = context.params as { id: string };
    const { body: reviewBody } = context.body as { body?: string };

    const pr = await resolvePrOrThrow(id);

    const approveGuard = checkPrActionable(pr, { operationLabel: '承認', requireOpen: true });
    if (approveGuard) {
      context.set.status = approveGuard.status;
      return approveGuard.body;
    }

    const repo = `${pr.integration.ownerName}/${pr.integration.repositoryName}`;
    await githubService.approvePullRequest(repo, pr.prNumber, reviewBody);

    // Create notification
    await prisma.notification.create({
      data: {
        type: 'pr_approved',
        title: 'PR承認完了',
        message: `PR #${pr.prNumber} (${pr.title}) を承認しました`,
        link: pr.url,
      },
    });

    return { success: true };
  })

  // Request PR changes
  .post('/pull-requests/:id/request-changes', async (context) => {
    const id = context.params.id;
    const reviewBody = (context.body as { body?: string }).body;

    const pr = await resolvePrOrThrow(id);

    const requestChangesGuard = checkPrActionable(pr, {
      operationLabel: '変更要求',
      requireOpen: true,
    });
    if (requestChangesGuard) {
      context.set.status = requestChangesGuard.status;
      return requestChangesGuard.body;
    }

    const repo = `${pr.integration.ownerName}/${pr.integration.repositoryName}`;
    await githubService.requestChanges(repo, pr.prNumber, reviewBody ?? '');

    return { success: true };
  })

  // Merge PR
  .post('/pull-requests/:id/merge', async (context) => {
    const { id } = context.params as { id: string };
    const { method, deleteBranch, auto } = (context.body ?? {}) as {
      method?: 'merge' | 'squash' | 'rebase';
      deleteBranch?: boolean;
      auto?: boolean;
    };

    const pr = await resolvePrOrThrow(id);

    const mergeGuard = checkPrActionable(pr, { operationLabel: 'マージ', requireOpen: true });
    if (mergeGuard) {
      context.set.status = mergeGuard.status;
      return mergeGuard.body;
    }

    const repo = `${pr.integration.ownerName}/${pr.integration.repositoryName}`;
    let mergeResult: { autoQueued: boolean };
    try {
      mergeResult = await githubService.mergePullRequest(repo, pr.prNumber, {
        method,
        deleteBranch,
        auto,
      });
    } catch (err) {
      // gh fails on conflicts / branch protection / not-approved — surface it.
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: `マージに失敗しました: ${message}` };
    }

    // When the merge was queued via auto-merge, it completes later once all
    // required checks pass — don't mark it merged or sync the local branch yet.
    if (mergeResult.autoQueued) {
      return { success: true, autoQueued: true };
    }

    await prisma.gitHubPullRequest
      .update({ where: { id: pr.id }, data: { state: 'merged', updatedAt: new Date() } })
      .catch(() => {});

    // Pull the merged changes into the LOCAL base branch so the working copy
    // reflects the merge. Best-effort — a sync failure doesn't fail the merge.
    let localSync: { synced: boolean; detail: string } | null = null;
    const workingDirectory = await resolvePrWorkingDirectory(pr.linkedTaskId);
    if (workingDirectory) {
      localSync = await githubService.syncLocalBranchWithRemote(workingDirectory, pr.baseBranch);
    }

    await prisma.notification
      .create({
        data: {
          type: 'pr_merged',
          title: 'PRマージ完了',
          message: `PR #${pr.prNumber} (${pr.title}) をマージしました`,
          link: pr.url,
        },
      })
      .catch(() => {});

    return { success: true, localSync };
  })

  // Change the base (merge target) branch of a PR.
  .patch('/pull-requests/:id/base', async (context) => {
    const { id } = context.params as { id: string };
    const { baseBranch } = (context.body ?? {}) as { baseBranch?: string };
    if (!baseBranch) {
      context.set.status = 400;
      return { success: false, error: 'baseBranch は必須です' };
    }

    const pr = await resolvePrOrThrow(id);

    const baseGuard = checkPrActionable(pr, { operationLabel: 'base変更', requireOpen: true });
    if (baseGuard) {
      context.set.status = baseGuard.status;
      return baseGuard.body;
    }

    const repo = `${pr.integration.ownerName}/${pr.integration.repositoryName}`;
    try {
      await githubService.changePullRequestBase(repo, pr.prNumber, baseBranch);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      context.set.status = 502;
      return { success: false, error: `マージ先ブランチの変更に失敗しました: ${message}` };
    }

    await prisma.gitHubPullRequest
      .update({ where: { id: pr.id }, data: { baseBranch, updatedAt: new Date() } })
      .catch(() => {});

    return { success: true, baseBranch };
  })

  // Resolve a PR's merge conflicts. Merges the base into the head branch in an
  // isolated worktree: pushes when clean (e.g. the branch was just behind base);
  // for real conflicts, files an agent task to resolve them.
  .post('/pull-requests/:id/resolve-conflicts', async (context) => {
    const { id } = context.params as { id: string };
    const pr = await resolvePrOrThrow(id);

    // The conflict resolution needs a local checkout of the repo — use the
    // linked task's (or its theme's) working directory.
    let workingDirectory: string | null = null;
    let themeId: number | null = null;
    if (pr.linkedTaskId != null) {
      const task = await prisma.task
        .findUnique({
          where: { id: pr.linkedTaskId },
          select: {
            workingDirectory: true,
            themeId: true,
            theme: { select: { workingDirectory: true } },
          },
        })
        .catch(() => null);
      workingDirectory = task?.workingDirectory ?? task?.theme?.workingDirectory ?? null;
      themeId = task?.themeId ?? null;
    }
    if (!workingDirectory) {
      context.set.status = 400;
      return {
        error:
          'このPRのローカルチェックアウトが特定できません（タスク/テーマに作業ディレクトリが必要です）',
      };
    }

    const result = await resolvePrConflicts(workingDirectory, pr.baseBranch, pr.headBranch);
    if (result.resolved) {
      return { resolved: true, conflicts: [], detail: result.detail };
    }

    // Real conflicts — file an agent task to resolve them on the PR branch.
    let taskId: number | undefined;
    if (result.conflicts.length > 0) {
      const instruction = [
        `PR #${pr.prNumber}「${pr.title}」のマージ競合を解消してください。`,
        `- マージ先(base): ${pr.baseBranch}`,
        `- PRブランチ(head): ${pr.headBranch}`,
        `- 競合ファイル: ${result.conflicts.join(', ')}`,
        '',
        '手順:',
        `1. git fetch origin ${pr.baseBranch} ${pr.headBranch}`,
        `2. git checkout ${pr.headBranch}（無ければ git checkout -b ${pr.headBranch} origin/${pr.headBranch}）`,
        `3. git merge origin/${pr.baseBranch} を実行`,
        '4. 競合を両者の意図を保ちつつ解消し、競合マーカー(<<<<<<< など)を残さない',
        '5. 変更を commit',
        `6. git push origin ${pr.headBranch} でPRブランチを更新`,
        '',
        '重要: 解消は PR ブランチへの push で完結し、このタスクの worktree には差分が残らないため、',
        'verify.md に必ず「変更不要: 競合解消は PR ブランチへ push 済み」と明記してください',
        '（空diffで誤ブロックされるのを防ぐため）。新規 PR は作成不要です。',
      ].join('\n');
      const task = await prisma.task
        .create({
          data: {
            title: `PR #${pr.prNumber} の競合を解消`,
            description: instruction,
            status: 'todo',
            priority: 'high',
            isDeveloperMode: true,
            ...(themeId != null && { themeId }),
            workingDirectory,
            // Link the existing PR so completion is NOT blocked by the "a PR must
            // be created" gate — a conflict task updates PR #N, it never opens a
            // new one. Also makes the task's "PRを開く" button resolve.
            githubPrId: pr.prNumber,
            // Resolving a merge conflict is MECHANICAL (merge base → fix markers →
            // push): no design decisions, no new feature, bounded to the conflict
            // files. The keyword scorer otherwise over-rates it because this
            // instruction embeds the original PR's title (e.g. "[Refactor] …抽象化"),
            // landing it in `standard` mode whose plan phase is pure overhead (the
            // agent auto-approves a trivial plan and moves on). Pin it to lightweight
            // (research→implement→verify, no plan) and override so the orchestrator's
            // complexity staging does not recompute it back up.
            workflowMode: 'lightweight',
            workflowModeOverride: true,
            complexityScore: 15,
          },
        })
        .catch(() => null);
      taskId = task?.id;
    }

    return { resolved: false, conflicts: result.conflicts, detail: result.detail, taskId };
  });
