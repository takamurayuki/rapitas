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
    log.info({ taskId }, 'No changes in worktree, cleaning up');
    await cleanupWorktree(workDir, executionDir, sessionId);
    await markTaskDone(taskId);
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
