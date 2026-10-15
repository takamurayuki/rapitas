/**
 * GitHub Pull Request Write Routes
 *
 * POST/PATCH operations: comments, approve, request-changes, merge, base-branch
 * change, and conflict resolution. Read operations live in pull-requests-read.ts.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../../config/database';
import { GitHubService } from '../../../services/core/github-service';
import { resolvePrConflicts } from '../../../services/github/conflict-resolver';
import { fileConflictResolutionTask } from '../../../services/github/conflict-task';
import { checkPrActionable } from '../../../services/github/pr-guards';
import { resolvePrOrThrow } from '../../../services/github/resource-guard';
import {
  resolvePrTaskContext,
  resolvePrWorkingDirectory,
  resolveThemeForWorkingDirectory,
} from '../../../services/github/pr-task-resolver';
import { makeOwnerRepoString } from '../../../services/github/owner-repo';

const githubService = new GitHubService(prisma);

export const pullRequestWriteRoutes = new Elysia()
  // Post PR comment
  .post(
    '/pull-requests/:id/comments',
    async (context) => {
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

      const repo = makeOwnerRepoString(pr.integration.ownerName, pr.integration.repositoryName);
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
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object(
        {
          body: t.String({ minLength: 1, maxLength: 10000 }),
          path: t.Optional(t.String()),
          line: t.Optional(t.Number()),
        },
        { additionalProperties: false },
      ),
    },
  )

  // Approve PR
  .post(
    '/pull-requests/:id/approve',
    async (context) => {
      const { id } = context.params as { id: string };
      const { body: reviewBody } = context.body as { body?: string };

      const pr = await resolvePrOrThrow(id);

      const approveGuard = checkPrActionable(pr, { operationLabel: '承認', requireOpen: true });
      if (approveGuard) {
        context.set.status = approveGuard.status;
        return approveGuard.body;
      }

      const repo = makeOwnerRepoString(pr.integration.ownerName, pr.integration.repositoryName);
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
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Optional(
        t.Object(
          { body: t.Optional(t.String({ maxLength: 10000 })) },
          { additionalProperties: false },
        ),
      ),
    },
  )

  // Request PR changes
  .post(
    '/pull-requests/:id/request-changes',
    async (context) => {
      const id = context.params.id;
      const reviewBody = (context.body as { body?: string } | undefined)?.body;

      const pr = await resolvePrOrThrow(id);

      const requestChangesGuard = checkPrActionable(pr, {
        operationLabel: '変更要求',
        requireOpen: true,
      });
      if (requestChangesGuard) {
        context.set.status = requestChangesGuard.status;
        return requestChangesGuard.body;
      }

      const repo = makeOwnerRepoString(pr.integration.ownerName, pr.integration.repositoryName);
      await githubService.requestChanges(repo, pr.prNumber, reviewBody ?? '');

      return { success: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Optional(
        t.Object(
          { body: t.Optional(t.String({ maxLength: 10000 })) },
          { additionalProperties: false },
        ),
      ),
    },
  )

  // Merge PR
  .post(
    '/pull-requests/:id/merge',
    async (context) => {
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

      const repo = makeOwnerRepoString(pr.integration.ownerName, pr.integration.repositoryName);
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
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Optional(
        t.Object(
          {
            method: t.Optional(
              t.Union([t.Literal('merge'), t.Literal('squash'), t.Literal('rebase')]),
            ),
            deleteBranch: t.Optional(t.Boolean()),
            auto: t.Optional(t.Boolean()),
          },
          { additionalProperties: false },
        ),
      ),
    },
  )

  // Change the base (merge target) branch of a PR.
  .patch(
    '/pull-requests/:id/base',
    async (context) => {
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

      const repo = makeOwnerRepoString(pr.integration.ownerName, pr.integration.repositoryName);
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
    },
    {
      params: t.Object({ id: t.String() }),
      // NOTE: git-ref-safety (shell metacharacters / traversal) is enforced
      // elsewhere (assertSafeGitRef at the worktree layer); this schema only
      // caps type/length so a malformed payload is rejected before reaching
      // the GitHub API call.
      body: t.Optional(
        t.Object(
          { baseBranch: t.Optional(t.String({ maxLength: 200 })) },
          { additionalProperties: false },
        ),
      ),
    },
  )

  // Resolve a PR's merge conflicts. Merges the base into the head branch in an
  // isolated worktree: pushes when clean (e.g. the branch was just behind base);
  // for real conflicts, files an agent task to resolve them.
  .post('/pull-requests/:id/resolve-conflicts', async (context) => {
    const { id } = context.params as { id: string };
    const pr = await resolvePrOrThrow(id);

    // The conflict resolution needs a local checkout of the repo. Resolve from the
    // PR's linked task → a task carrying this PR number → and, as a last resort, the
    // backend's own repo checkout. The last fallback is safe because resolvePrConflicts
    // runs in a THROWAWAY worktree (never touches the checkout's branch), so a PR with
    // no task link (linkedTaskId & githubPrId both null — title-linked PRs like
    // "[#289] …") can still be resolved instead of failing with
    // "ローカルチェックアウトが特定できません".
    const ctx = await resolvePrTaskContext(pr.linkedTaskId, pr.prNumber);
    const workingDirectory = ctx.workingDirectory ?? process.cwd();
    // Attribute the conflict task to a theme even when no task link gave one, so
    // it is visible in the theme-filtered task list (a themeId=null task is hidden).
    const themeId = ctx.themeId ?? (await resolveThemeForWorkingDirectory(workingDirectory));

    const result = await resolvePrConflicts(workingDirectory, pr.baseBranch, pr.headBranch);
    if (result.resolved) {
      return { resolved: true, conflicts: [], detail: result.detail };
    }

    // Real conflicts — file an agent task to resolve them on the PR branch
    // (shared with the AutoMergeWatcher's auto-conflict path; deduped).
    let taskId: number | undefined;
    if (result.conflicts.length > 0) {
      const filed = await fileConflictResolutionTask(
        {
          prNumber: pr.prNumber,
          title: pr.title,
          baseBranch: pr.baseBranch,
          headBranch: pr.headBranch,
        },
        workingDirectory,
        themeId,
      );
      taskId = filed.taskId ?? undefined;
    }

    return { resolved: false, conflicts: result.conflicts, detail: result.detail, taskId };
  });
