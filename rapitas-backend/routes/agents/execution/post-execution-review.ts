/**
 * Post-Execution Review Pipeline
 *
 * After agent execution completes successfully in a worktree:
 * 1. AI reviews the diff for quality (Ollama free → Haiku fallback)
 * 2. If approved, commits changes and creates a PR
 * 3. Cleans up the worktree only after PR is confirmed created
 *
 * If review finds issues, the worktree is preserved for manual inspection.
 */
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { sendAIMessage } from '../../../utils/ai-client';
import { getLocalLLMStatus } from '../../../services/local-llm';
import { AgentWorkerManager } from '../../../services/agents/agent-worker-manager';
import { createCommit } from '../../../services/agents/orchestrator/git-operations/core-ops';
import { createPullRequest } from '../../../services/agents/orchestrator/git-operations/branch-pr-ops';

const log = createLogger('routes:post-execution-review');
const agentWorkerManager = AgentWorkerManager.getInstance();

const REVIEW_PROMPT = `あなたはシニアコードレビュアーです。以下のgit diffをレビューしてください。

## タスク: {title}

## 変更差分
{diff}

以下のJSON形式で返してください（他のテキスト不要）:
{
  "approved": true/false,
  "summary": "変更内容の要約（1-2文）",
  "issues": ["問題点があれば記載"],
  "commitMessage": "適切なコミットメッセージ（conventional commits形式: feat/fix/refactor等）"
}

承認基準:
- コードが動作しそうか（明らかな構文エラーがないか）
- 意図しないファイルの削除や破壊的変更がないか
- 明確なバグの混入がないか
軽微なスタイル問題は承認してください。`;

interface ReviewParams {
  taskId: number;
  taskTitle: string;
  sessionId: number;
  workDir: string;
  executionDir: string;
  branchName?: string;
  executionOutput?: string;
}

/**
 * AI review → commit → PR → cleanup pipeline.
 * Called as fire-and-forget from execute-post-handler.
 *
 * @param params - Execution context / 実行コンテキスト
 */
export async function reviewAndCommitWorktree(params: ReviewParams): Promise<void> {
  const { taskId, taskTitle, sessionId, workDir, executionDir, branchName } = params;

  log.info({ taskId, executionDir }, 'Starting post-execution review pipeline');

  // 1. Get the diff from the worktree
  const diff = await getDiff(executionDir);
  if (!diff.trim()) {
    // NOTE: Workflow files (research.md / plan.md / verify.md) are stored
    // OUTSIDE the worktree at `~/.rapitas/workflows/...` so their creation does
    // NOT show up in `git diff`. If the agent followed the workflow correctly
    // (saved research/plan via the workflow API and then exited without code
    // changes), `task.workflowStatus` will have transitioned to a planning
    // state. Treat that as a successful planning phase — NOT a blocked failure.
    const taskState = await prisma.task
      .findUnique({ where: { id: taskId }, select: { workflowStatus: true } })
      .catch(() => null);
    const planningStatuses = new Set(['research_done', 'plan_created', 'plan_approved']);
    if (taskState?.workflowStatus && planningStatuses.has(taskState.workflowStatus)) {
      log.info(
        { taskId, sessionId, workflowStatus: taskState.workflowStatus },
        'Agent completed planning phase (research/plan saved). Awaiting user approval before implementation.',
      );
      await prisma.task
        .update({ where: { id: taskId }, data: { status: 'in_progress' } })
        .catch((err) => log.warn({ err, taskId }, 'Failed to update task status'));
      // Worktree is preserved so the next execution (after user approves the
      // plan in the UI) can pick up where this one left off.
      return;
    }

    // NOTE: Empty diff with no planning artifacts almost always means the agent
    // gave up mid-task without making any change (CLI crashed, vitest EPERM,
    // agent hallucinated completion, ignored the workflow instruction, etc.).
    // DO NOT silently mark the task as done — surface it to the user as
    // `blocked` so they can inspect the worktree and re-run.
    log.warn(
      { taskId, sessionId, workflowStatus: taskState?.workflowStatus ?? null },
      'Agent reported success but produced no diff and no planning artifacts — marking task as blocked',
    );
    await prisma.task
      .update({ where: { id: taskId }, data: { status: 'blocked' } })
      .catch((err) => log.warn({ err, taskId }, 'Failed to update task to blocked'));
    await prisma.agentSession
      .update({
        where: { id: sessionId },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage:
            'Agent finished but produced no file changes and no workflow artifacts (research.md/plan.md). Possible causes: verification command crashed, agent ignored the workflow instruction, or hallucinated completion. Worktree preserved for inspection.',
        },
      })
      .catch((err) => log.warn({ err, sessionId }, 'Failed to update session to failed'));
    // NOTE: Worktree intentionally preserved (not cleaned up) so the user can
    // inspect what the agent did/did not do. The worktree-cleanup-scheduler
    // will eventually remove it after the configured retention window.
    return;
  }

  // NOTE: If the agent produced code changes but did NOT save a plan.md via
  // the workflow API, the agent ignored the workflow instructions entirely
  // (codex CLI is known to do this — it's optimized for "implement now" and
  // does not respect "save plan and stop" instructions). Revert the worktree
  // to discard the unauthorized changes and block the task so the user is
  // forced to re-run the planning phase.
  const taskWithStatus = await prisma.task
    .findUnique({ where: { id: taskId }, select: { workflowStatus: true } })
    .catch(() => null);
  const status = taskWithStatus?.workflowStatus;
  const planFile = await prisma.workflowFile
    .findFirst({ where: { taskId, fileType: 'plan' }, select: { id: true } })
    .catch(() => null);
  const planExists = !!planFile;

  if (!planExists) {
    log.error(
      { taskId, sessionId, workflowStatus: status, diffSize: diff.length },
      'Agent produced code changes WITHOUT saving plan.md — workflow violated. Reverting worktree and blocking task.',
    );
    // Discard the agent's unauthorized changes so the user has a clean slate
    // to retry from. The branch + worktree are preserved (just the working
    // tree is reset to HEAD).
    try {
      const { execSync } = await import('node:child_process');
      execSync('git reset --hard HEAD', { cwd: executionDir, timeout: 30000 });
      execSync('git clean -fd', { cwd: executionDir, timeout: 30000 });
      log.info({ taskId, executionDir }, 'Reverted unauthorized agent changes');
    } catch (revertErr) {
      log.warn(
        { err: revertErr, taskId },
        'Failed to revert worktree (proceeding to mark blocked)',
      );
    }
    await prisma.task
      .update({ where: { id: taskId }, data: { status: 'blocked' } })
      .catch((err) => log.warn({ err, taskId }, 'Failed to update task to blocked'));
    await prisma.agentSession
      .update({
        where: { id: sessionId },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage:
            'ワークフロー違反: エージェントが plan.md を保存せずに直接コードを変更しました (codex CLI は「計画して停止」指示を無視する傾向があります)。worktree の未承認変更は破棄しました。タスクを再実行すれば調査・計画フェーズからやり直します。',
        },
      })
      .catch((err) => log.warn({ err, sessionId }, 'Failed to update session to failed'));
    return;
  }

  // NOTE: plan.md exists but isn't approved yet — agent jumped ahead from
  // planning to implementation in a single run. Preserve the diff (it might
  // be salvageable) but block the commit/PR until user approves the plan.
  if (status === 'plan_created') {
    log.warn(
      { taskId, sessionId, workflowStatus: status },
      'Agent produced code changes but plan.md is not yet approved — blocking commit/PR until user approves the plan',
    );
    await prisma.task
      .update({ where: { id: taskId }, data: { status: 'blocked' } })
      .catch((err) => log.warn({ err, taskId }, 'Failed to update task to blocked'));
    await prisma.agentSession
      .update({
        where: { id: sessionId },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage:
            'Agent implemented before the user approved plan.md. Worktree changes preserved for review. Approve the plan in the UI and re-run, or discard the worktree.',
        },
      })
      .catch((err) => log.warn({ err, sessionId }, 'Failed to update session to failed'));
    return;
  }

  // 2. AI Review
  const review = await runAIReview(taskTitle, diff);
  if (!review) {
    log.warn({ taskId }, 'AI review returned no result, preserving worktree for manual inspection');
    return;
  }

  if (!review.approved) {
    log.info({ taskId, issues: review.issues }, 'AI review rejected changes, preserving worktree');
    return;
  }

  log.info({ taskId, summary: review.summary }, 'AI review approved');

  // 3. Commit
  const commitMsg = review.commitMessage || `feat(task-${taskId}): ${taskTitle}`;
  let commitHash: string;
  try {
    const commitResult = await createCommit(executionDir, commitMsg);
    commitHash = commitResult.hash;
  } catch (commitErr) {
    log.warn({ taskId, err: commitErr }, 'Commit failed, preserving worktree');
    return;
  }

  log.info({ taskId, hash: commitHash }, 'Changes committed');

  // 4. Create PR
  const prBody = [
    `## ${review.summary}`,
    '',
    `Task: #${taskId}`,
    '',
    '---',
    '🤖 AI-reviewed and auto-committed by Rapitas',
  ].join('\n');

  const prTitle = `[Task-${taskId}] ${taskTitle}`;
  const prResult = await createPullRequest(executionDir, prTitle, prBody, branchName);
  if (!prResult.success) {
    log.warn({ taskId, error: prResult.error }, 'PR creation failed, worktree preserved');
    return;
  }

  log.info({ taskId, prUrl: prResult.prUrl, prNumber: prResult.prNumber }, 'PR created');

  // 5. Cleanup worktree only after PR is confirmed
  await cleanupWorktree(workDir, executionDir, sessionId);

  // 6. Mark task as done — all steps completed successfully
  await markTaskDone(taskId);

  log.info({ taskId }, 'Post-execution review pipeline completed');
}

/** Get git diff from worktree. */
async function getDiff(dir: string): Promise<string> {
  try {
    const { execSync } = await import('child_process');
    // Staged + unstaged changes
    const staged = execSync('git diff --cached --stat', {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 10000,
    });
    const unstaged = execSync('git diff --stat', { cwd: dir, encoding: 'utf-8', timeout: 10000 });
    const untracked = execSync('git ls-files --others --exclude-standard', {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 10000,
    });

    // Get actual diff content (limited to prevent token overflow)
    const diffContent = execSync('git diff HEAD --no-color -U3', {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });

    const parts = [staged, unstaged, untracked].filter(Boolean).join('\n');
    if (!parts.trim() && !diffContent.trim()) return '';

    // Truncate large diffs for AI review
    return diffContent.slice(0, 8000);
  } catch {
    return '';
  }
}

interface ReviewResult {
  approved: boolean;
  summary: string;
  issues: string[];
  commitMessage: string;
}

/** Run AI review on the diff. */
async function runAIReview(title: string, diff: string): Promise<ReviewResult | null> {
  try {
    const localStatus = await getLocalLLMStatus().catch(() => ({ available: false }));
    const useLocal = (localStatus as { available: boolean }).available;

    const prompt = REVIEW_PROMPT.replace('{title}', title).replace('{diff}', diff);

    const response = await sendAIMessage({
      provider: useLocal ? 'ollama' : 'claude',
      model: useLocal ? 'llama3.2' : 'claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 500,
    });

    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    return JSON.parse(jsonMatch[0]) as ReviewResult;
  } catch (err) {
    log.warn({ err }, 'AI review call failed');
    return null;
  }
}

/** Clean up worktree and update DB. */
async function cleanupWorktree(
  workDir: string,
  executionDir: string,
  sessionId: number,
): Promise<void> {
  try {
    await agentWorkerManager.removeWorktree(workDir, executionDir);
    await prisma.agentSession.update({
      where: { id: sessionId },
      data: { worktreePath: null },
    });
    log.info({ sessionId }, 'Worktree cleaned up');
  } catch (err) {
    log.warn({ err, sessionId }, 'Worktree cleanup failed');
  }
}

/** Mark task as done with completedAt timestamp. */
async function markTaskDone(taskId: number): Promise<void> {
  try {
    await prisma.task.update({
      where: { id: taskId },
      data: { status: 'done', completedAt: new Date() },
    });
    log.info({ taskId }, 'Task marked as done');
  } catch (err) {
    log.warn({ err, taskId }, 'Failed to mark task as done');
  }
}
