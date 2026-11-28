/**
 * Verification Cache Key
 *
 * Fingerprints a task worktree plus the task's DB-sourced verification inputs
 * so a self-verification run can detect inputs that changed while it ran.
 * Moved unchanged out of verification-job-runner.ts to keep that file under
 * the 300-line split threshold; not responsible for running the gate.
 */
import { createHash } from 'crypto';
import { readFile, lstat } from 'fs/promises';
import { join } from 'path';
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import { requiresTestsForTask } from '../agents/verification/automated-verifier';
import { resolveAcceptanceCriteria } from '../agents/verification/acceptance-self-check';
import { readWorkflowFile } from './workflow-file-utils';
import { resolvePreferredBaseBranch } from '../task/task-resolver';
import { runGitCommand } from '../github/git-exec';

const log = createLogger('services:workflow:verification-job-runner');

/** Default cap on total untracked-file bytes hashed into the cache key. */
const DEFAULT_MAX_UNTRACKED_BYTES = 32 * 1024 * 1024;
/** Default cap on the number of untracked files hashed into the cache key. */
const DEFAULT_MAX_UNTRACKED_FILES = 500;

/** Inputs covered by the concurrent-change fingerprint. */
export interface VerificationCacheInputs {
  worktreePath: string;
  planContent?: string;
  acceptanceCriteria?: string[];
  requireTests: boolean;
  preferredBaseBranch?: string | null;
  taskText?: string;
}

/**
 * Fingerprint Git content and the supplied task inputs to detect changes
 * during verification. This is not a complete identity for external state
 * and must never authorize reuse of a completed verification result.
 * Structured path/content-digest pairs avoid ambiguous binary boundaries.
 *
 * @param inputs - Worktree and task inputs observed for this run.
 * @returns Fingerprint, or null when inputs cannot be identified.
 */
export async function computeVerificationCacheKey(
  inputs: VerificationCacheInputs,
): Promise<string | null> {
  const { worktreePath } = inputs;
  try {
    const [head, diff, untrackedRaw] = await Promise.all([
      runGitCommand(['rev-parse', 'HEAD'], worktreePath, { timeoutMs: 5_000, skipLog: true }),
      runGitCommand(['diff', 'HEAD'], worktreePath, { timeoutMs: 10_000, skipLog: true }),
      runGitCommand(['ls-files', '--others', '--exclude-standard', '-z'], worktreePath, {
        timeoutMs: 5_000,
        skipLog: true,
      }),
    ]);
    const untrackedPaths = untrackedRaw.split('\0').filter(Boolean).sort();

    const maxBytes =
      Number(process.env.RAPITAS_SELFVERIFY_MAX_UNTRACKED_BYTES) || DEFAULT_MAX_UNTRACKED_BYTES;
    const maxFiles =
      Number(process.env.RAPITAS_SELFVERIFY_MAX_UNTRACKED_FILES) || DEFAULT_MAX_UNTRACKED_FILES;
    if (untrackedPaths.length > maxFiles) {
      log.warn(
        { worktreePath, files: untrackedPaths.length, maxFiles },
        '[self-verification] untracked file count exceeds cache safety valve — bypassing cache',
      );
      return null;
    }

    // lstat (not stat) so a symlink is detected as such rather than followed —
    // its target's identity cannot be safely tracked (Windows junction/symlink
    // resolution is complex and target changes aren't reflected here), so any
    // untracked symlink bypasses the cache entirely per the safety-valve
    // philosophy. Also totals size before reading full content so an
    // oversized set is rejected without paying to read every byte first.
    let totalBytes = 0;
    for (const relPath of untrackedPaths) {
      const st = await lstat(join(worktreePath, relPath));
      if (st.isSymbolicLink()) {
        log.warn(
          { worktreePath, relPath },
          '[self-verification] untracked symlink — identity cannot be guaranteed, bypassing cache',
        );
        return null;
      }
      totalBytes += st.size;
      if (totalBytes > maxBytes) {
        log.warn(
          { worktreePath, totalBytes, maxBytes },
          '[self-verification] untracked content exceeds cache safety valve — bypassing cache',
        );
        return null;
      }
    }

    const fileEntries: Array<[string, string]> = [];
    for (const relPath of untrackedPaths) {
      const content = await readFile(join(worktreePath, relPath));
      fileEntries.push([relPath, createHash('sha256').update(content).digest('hex')]);
    }

    const hash = createHash('sha256');
    const sep = Buffer.from([0]);
    hash.update(head);
    hash.update(sep);
    hash.update(diff);
    hash.update(sep);
    hash.update(JSON.stringify(fileEntries));
    hash.update(sep);
    hash.update(worktreePath);
    hash.update(sep);
    hash.update(inputs.planContent ?? '');
    hash.update(sep);
    hash.update(JSON.stringify(inputs.acceptanceCriteria ?? []));
    hash.update(sep);
    hash.update(String(inputs.requireTests));
    hash.update(sep);
    hash.update(inputs.preferredBaseBranch ?? '');
    hash.update(sep);
    hash.update(inputs.taskText ?? '');
    return hash.digest('hex');
  } catch (err) {
    log.warn(
      { err, worktreePath },
      '[self-verification] cache identity unavailable — bypassing cache for this request',
    );
    return null;
  }
}

/**
 * Load every DB-sourced input that feeds both the gate and the cache
 * identity. Called twice per job — before and after the gate runs — so
 * that a plan/task/acceptance-criteria edit made WHILE verification was in
 * flight (which can take minutes) is reflected in `keyAfter` and correctly
 * invalidates the measured result, not just an in-memory worktree re-hash of
 * variables captured before the run started.
 *
 * @param taskId - Task whose plan/acceptance/base branch to load. / 対象タスクID
 * @param worktreePath - Task's agent worktree. / worktreeパス
 * @returns Cache-identity inputs (also reused to build the gate's options). / 検証入力一式
 */
export async function buildCacheInputs(
  taskId: number,
  worktreePath: string,
): Promise<VerificationCacheInputs> {
  const [planContent, preferredBaseBranch, taskRow] = await Promise.all([
    readWorkflowFile(taskId, 'plan'),
    resolvePreferredBaseBranch(taskId),
    // Unavailable task inputs must not silently weaken the verification gate.
    prisma.task.findUnique({
      where: { id: taskId },
      select: { title: true, description: true, acceptanceCriteria: true },
    }),
  ]);
  if (!taskRow) throw new Error('Verification task inputs are unavailable');
  const taskText = `${taskRow.title}\n${taskRow.description ?? ''}`;
  const acceptanceCriteria = resolveAcceptanceCriteria(taskRow);
  return {
    worktreePath,
    planContent: planContent ?? undefined,
    acceptanceCriteria: acceptanceCriteria.length > 0 ? acceptanceCriteria : undefined,
    requireTests: requiresTestsForTask(taskText),
    preferredBaseBranch,
    taskText: taskText || undefined,
  };
}
