/**
 * continuation-pr-detect
 *
 * Detects a PR an agent created directly (`gh pr create`) while resuming a
 * task via POST /tasks/:id/continue-execution, and links it the same way the
 * regular workflow/single-shot completion paths do. continue-execution's
 * post-handler never called linkAutoCreatedPr, so Task.githubPrId and
 * GitHubPullRequest.linkedTaskId stayed null for every PR made through this
 * route (task 882/905/914). Not responsible for creating the PR — only for
 * finding one that already exists on the branch and linking it.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import type { PrismaClient } from '../../generated/prisma-postgres';
import { createLogger } from '../../config/logger';
import { hasTaskIdMarker } from '../../utils/common/branch-name-generator';
import { extractTaskMarkerId } from './pr-ownership';
import { linkAutoCreatedPr } from './pr-link';

const log = createLogger('github-service:continuation-pr-detect');
type PrismaClientInstance = InstanceType<typeof PrismaClient>;

const execFileAsync = promisify(execFile);

// Same binary as gh-client.ts; duplicated rather than imported to avoid a
// services/github -> services/agents/orchestrator dependency (see gh-client.ts).
const GH_BIN = process.platform === 'win32' ? 'C:\\Program Files\\GitHub CLI\\gh.exe' : 'gh';

// Read-only lookup on an already-completed async post-handler — kept well
// below gh-client's 120s GH_CLI_TIMEOUT_MS so it never meaningfully delays
// worktree cleanup.
const CONTINUATION_PR_LOOKUP_TIMEOUT_MS = 30_000;

interface GhPrListResult {
  number?: number;
  url?: string;
  baseRefName?: string;
  title?: string;
  body?: string;
}

/** Parameters for {@link detectAndLinkContinuationPr}. */
export interface DetectAndLinkContinuationPrParams {
  /** Task the continuation ran for. / 継続実行の対象タスクID */
  taskId: number;
  /** Task title, used as a linkAutoCreatedPr fallback. / PRタイトルのフォールバック */
  taskTitle: string;
  /** Session branch name the continuation ran on. / 継続実行が使ったブランチ名 */
  branchName: string | null | undefined;
  /** Worktree/checkout directory `gh pr list` runs in. / gh実行時のcwd */
  workingDirectory: string;
}

/**
 * Detect and link a PR an agent created directly during continue-execution.
 *
 * Best-effort: any failure (gh CLI error/timeout, ownership mismatch) is
 * logged and swallowed — a detection problem must never fail the
 * continuation's completion flow.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param params - Continuation context / 継続実行コンテキスト
 * @returns Local GitHubPullRequest id when linked, otherwise null / リンクされたローカルPR ID
 */
export async function detectAndLinkContinuationPr(
  prisma: PrismaClientInstance,
  params: DetectAndLinkContinuationPrParams,
): Promise<number | null> {
  const { taskId, taskTitle, branchName, workingDirectory } = params;

  if (!branchName) {
    log.warn({ taskId }, '[continuation-pr-detect] No branch name — skipping PR detection');
    return null;
  }

  try {
    const { stdout } = await execFileAsync(
      GH_BIN,
      [
        'pr',
        'list',
        '--head',
        branchName,
        '--state',
        'open',
        '--json',
        'number,url,baseRefName,title,body',
        '--jq',
        '.[0]',
      ],
      { cwd: workingDirectory, encoding: 'utf8', timeout: CONTINUATION_PR_LOOKUP_TIMEOUT_MS },
    );

    const trimmed = stdout.trim();
    if (!trimmed || trimmed === 'null') return null;

    const pr = JSON.parse(trimmed) as GhPrListResult;
    if (!pr.number || !pr.url) return null;

    if (!hasTaskIdMarker(branchName, taskId)) {
      log.warn(
        { taskId, prNumber: pr.number, branchName },
        '[continuation-pr-detect] Branch name does not carry this task marker — refusing to link',
      );
      return null;
    }

    const titleMarkerId = extractTaskMarkerId(pr.title);
    if (titleMarkerId != null && titleMarkerId !== taskId) {
      log.warn(
        { taskId, prNumber: pr.number, titleMarkerId },
        '[continuation-pr-detect] PR title marker names a different task — refusing to link',
      );
      return null;
    }
    const bodyMarkerId = extractTaskMarkerId(pr.body);
    if (bodyMarkerId != null && bodyMarkerId !== taskId) {
      log.warn(
        { taskId, prNumber: pr.number, bodyMarkerId },
        '[continuation-pr-detect] PR body marker names a different task — refusing to link',
      );
      return null;
    }

    return await linkAutoCreatedPr(prisma, {
      taskId,
      prNumber: pr.number,
      prUrl: pr.url,
      title: pr.title ?? taskTitle,
      headBranch: branchName,
      baseBranch: pr.baseRefName ?? 'develop',
      workingDirectory,
    });
  } catch (err) {
    log.warn({ err, taskId, branchName }, '[continuation-pr-detect] PR detection failed');
    return null;
  }
}
