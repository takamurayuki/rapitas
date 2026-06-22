/**
 * PR Task Resolver
 *
 * Task-to-PR and task-to-working-directory resolution helpers extracted from
 * the pull-requests route. Not responsible for HTTP handling or PR mutations.
 */
import { prisma } from '../../config/database';
import { runGhCommand } from './gh-client';

/**
 * Whether a PR title belongs to the given task.
 *
 * Accepts both PR-title conventions in use: the app's auto-PR format
 * `[Task-{id}] ...` and the agent's CLAUDE.md format `[#{id}] ...`. Used only as
 * a last-resort heuristic after the linkedTaskId/githubPrId links are checked.
 *
 * @param title - PR title to test (may be undefined). / PRタイトル
 * @param taskId - Task id to match against. / 対象タスクID
 * @returns true when the title references the task. / 一致すればtrue
 */
export function titleMatchesTask(title: string | null | undefined, taskId: number): boolean {
  if (!title) return false;
  return title.includes(`[Task-${taskId}]`) || title.includes(`[#${taskId}]`);
}

/**
 * Resolve the local working directory for a PR's merge so we can sync the base
 * branch afterwards. Uses the linked task's working directory, falling back to
 * its theme's. Returns null when none is known (sync is then skipped).
 *
 * @param linkedTaskId - The PR's linked task id (may be null). / PRに紐づくタスクID
 * @returns Local repo path, or null. / ローカルリポジトリパス、無ければnull
 */
export async function resolvePrWorkingDirectory(linkedTaskId: number | null): Promise<string | null> {
  if (linkedTaskId == null) return null;
  const task = await prisma.task
    .findUnique({
      where: { id: linkedTaskId },
      select: { workingDirectory: true, theme: { select: { workingDirectory: true } } },
    })
    .catch(() => null);
  return task?.workingDirectory ?? task?.theme?.workingDirectory ?? null;
}

/**
 * Last-resort PR resolution: ask GitHub directly for a PR titled `[Task-{id}]`
 * or `[#{id}]` in the task's repo. Covers the case where the PR was created but
 * never persisted locally (e.g. no GitHubIntegration for that repo, or linking
 * failed), so "PRを開く" still navigates instead of dead-ending. Read-only.
 *
 * @param taskId - Task whose PR to find. / 対象タスクID
 * @returns The PR number + url, or null when none is found. / PR番号とURL、無ければnull
 */
export async function findPrViaGh(taskId: number): Promise<{ prNumber: number; prUrl: string } | null> {
  const cwd = await resolvePrWorkingDirectory(taskId);
  if (!cwd) return null;
  try {
    // List then substring-match the title (gh `--search` mishandles the `[...]`
    // tokens). The app's auto-PR titles are `[Task-{id}] ...`, but agent-created
    // PRs follow the CLAUDE.md convention `[#{id}] ...`, so accept both.
    const raw = await runGhCommand(
      ['pr', 'list', '--state', 'all', '--limit', '100', '--json', 'number,url,title'],
      cwd,
    );
    const prs = JSON.parse(raw || '[]') as {
      number: number;
      url: string;
      title: string;
    }[];
    const match = prs.find((p) => titleMatchesTask(p.title, taskId));
    return match ? { prNumber: match.number, prUrl: match.url } : null;
  } catch {
    return null;
  }
}
