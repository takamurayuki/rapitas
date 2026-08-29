/**
 * Workflow CLI Executor Helpers
 *
 * Runtime-state-free helpers and constants shared by the CLI executor modules:
 * git-root resolution, linked-PR lookup, workflow status ranking, and
 * phase-output validation dispatch. Not responsible for any phase orchestration.
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import { prisma } from '../../config';
import {
  validateResearch,
  validatePlan,
  validateVerify,
  type ValidationResult,
} from './phase-output-validator';

const execAsync = promisify(exec);

/**
 * Resolves the git repository root for a directory.
 *
 * @param dir - Directory to resolve from / 起点ディレクトリ
 * @returns Repo root path, or null when not inside a git repo / リポジトリルート、無ければ null
 */
export async function resolveGitRoot(dir: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync('git rev-parse --show-toplevel', {
      cwd: dir,
      encoding: 'utf8',
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Max age for a validation-failure transition to count as "just recorded by this call". */
const VALIDATION_FAILURE_RECENCY_WINDOW_MS = 30_000;

/**
 * Whether the HTTP file-save gate (status-transition.ts) already recorded its
 * own `verify_validation_failed` transition for this task moments ago.
 *
 * status-transition.ts exhausts attemptVerifyRepair() and records
 * `verify_validation_failed` SYNCHRONOUSLY during the agent's verify.md save.
 * The CLI/orchestrator epilogue (resolveVerifyPhaseStatus) runs afterwards on
 * its own copy of the same hard-fail validation and, without this check, calls
 * attemptVerifyRepair() a second time — exhausting it again and recording a
 * second `verify_validation_failed` transition ~10s later for the identical
 * failure. Two rows for one event then trips self-incident-watcher's
 * repeat-loop detector (60-minute window, threshold 2) as a false-positive
 * retry loop (task 720). Mirrors wasNonConvergenceCutoffJustRecorded's
 * DB-read pattern (routes/workflow/handlers/file-save/shared.ts).
 *
 * @param taskId - Task id / タスクID
 * @returns Whether the failure transition was just recorded / 直近に失敗遷移が記録されたか
 */
export async function wasVerifyValidationFailureJustRecorded(taskId: number): Promise<boolean> {
  const last = await prisma.workflowTransition
    .findFirst({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
      select: { cause: true, createdAt: true },
    })
    .catch(() => null);
  if (!last || last.cause !== 'verify_validation_failed') return false;
  return Date.now() - last.createdAt.getTime() <= VALIDATION_FAILURE_RECENCY_WINDOW_MS;
}

/**
 * Whether a task already has a created PR — an app-linked GitHubPullRequest row
 * or a task.githubPrId. Used to gate verify-time completion on a PR existing, so
 * a passing verify never completes a task that produced no PR.
 *
 * @param taskId - Task id / タスクID
 * @returns true when a PR is already recorded for the task / PR記録済みなら true
 */
export async function taskHasLinkedPr(taskId: number): Promise<boolean> {
  const linked = await prisma.gitHubPullRequest
    .findFirst({ where: { linkedTaskId: taskId }, select: { id: true } })
    .catch(() => null);
  if (linked) return true;
  const row = await prisma.task
    .findUnique({ where: { id: taskId }, select: { githubPrId: true } })
    .catch(() => null);
  return row?.githubPrId != null;
}

/**
 * Linear rank of each workflow status, used to advance status FORWARD only.
 * The HTTP file-save handler may have already advanced the task (e.g. plan
 * auto-approved, or verify auto-completed); the executor must not regress it
 * back to the phase's nominal nextStatus afterwards.
 */
export const WF_STATUS_RANK: Record<string, number> = {
  draft: 0,
  // Same rank as draft (not a missing/fallback value): a paused intake
  // question isn't further along than draft, and must never be treated as
  // "behind" some later status in a way that lets a forward-advance check
  // skip over the pause and jump straight to a later phase.
  awaiting_question: 0,
  research_done: 1,
  plan_created: 2,
  plan_approved: 3,
  in_progress: 4,
  verify_done: 5,
  completed: 6,
};

/**
 * Dispatch validation by output-file type. Returns a permissive result for
 * unknown types so the executor doesn't reject legitimate artifacts.
 *
 * @param outputFile - Workflow output file type / 対象の成果物種別
 * @param content - Artifact markdown content / 成果物の本文
 * @returns Structural validation result / 構造バリデーション結果
 */
export function validateOutput(outputFile: string, content: string): ValidationResult {
  switch (outputFile) {
    case 'research':
      return validateResearch(content);
    case 'plan':
      return validatePlan(content);
    case 'verify':
      return validateVerify(content);
    default:
      return { ok: true, missingSections: [], severity: 0, summary: 'no validator' };
  }
}
