/**
 * GitHub Pull Request Write Routes
 *
 * POST/PATCH operations: comments, approve, request-changes, merge, base-branch
 * change, and conflict resolution. Read operations live in pull-requests-read.ts.
 */
import { Elysia } from 'elysia';
import { prisma } from '../../../config/database';
import { GitHubService } from '../../../services/core/github-service';
import { resolvePrConflicts } from '../../../services/github/conflict-resolver';
import { checkPrActionable } from '../../../services/github/pr-guards';
import { resolvePrOrThrow } from '../../../services/github/resource-guard';
import { resolvePrWorkingDirectory } from '../../../services/github/pr-task-resolver';

const githubService = new GitHubService(prisma);

export const pullRequestWriteRoutes = new Elysia()
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
