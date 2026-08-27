/**
 * PrePrBaseSync
 *
 * Merges the up-to-date base branch (origin/<base>) into the task's own
 * worktree branch RIGHT BEFORE the auto-PR is created, so drift against base is
 * caught while the task's context is still at hand instead of surfacing later
 * as a post-merge conflict task (task 573: PRs #338/#358/#363 all conflicted
 * because each branched from a stale develop). Real conflicts are resolved
 * in-place by a single bounded aux-AI call; unresolvable ones abort the merge
 * and the caller withholds PR creation.
 * Not responsible for commit/push/PR execution — see workflow-auto-commit.ts.
 */
import { createLogger } from '../../config/logger';

const log = createLogger('workflow:pre-pr-base-sync');

/** Terminal classification of one base-sync attempt. */
export type BaseSyncStatus =
  | 'skipped' // infra failure (fetch/merge setup) — fail-open, PR proceeds
  | 'clean' // base merged cleanly (or already up to date); re-verify OK when needed
  | 'resolved' // real conflicts resolved by the injected resolver; re-verify OK
  | 'conflict_unresolved' // conflicts remain — merge aborted, PR must be withheld
  | 'reverify_failed'; // merge landed but lint/typecheck re-verification failed

export interface BaseSyncResult {
  status: BaseSyncStatus;
  /** Files the merge changed on the branch (0 = already up to date). */
  changedFiles: number;
  /** Conflicting files when the merge stopped on content conflicts. */
  conflicts: string[];
  /** Human-readable detail (kept OUT of completion-classification error blobs). */
  detail: string;
}

/** Injected side-effect boundary — production defaults live in this module. */
export interface BaseSyncDeps {
  /** Run a git command in a cwd and return trimmed stdout (throws on non-zero). */
  runGit: (args: string[], cwd: string, opts?: { skipLog?: boolean }) => Promise<string>;
  /** Resolve the listed conflicted files in-place; true = resolved & committed. */
  resolveConflicts: (p: {
    gitCwd: string;
    taskId: number;
    baseBranch: string;
    conflicts: string[];
  }) => Promise<boolean>;
  /** Lightweight lint/typecheck re-verification; true = gate open. */
  runVerify: (taskId: number, gitCwd: string, sessionId?: number) => Promise<boolean>;
}

/** Build the production deps (lazy imports keep the test module graph light). */
async function defaultDeps(): Promise<BaseSyncDeps> {
  const { runGitCommand } = await import('../github/git-exec');
  return {
    runGit: (args, cwd, opts) => runGitCommand(args, cwd, opts),
    resolveConflicts: resolveConflictsWithAuxCli,
    runVerify: async (taskId, gitCwd, sessionId) => {
      const { runVerificationGate } = await import('../agents/verification/verification-gate');
      const gate = await runVerificationGate(taskId, gitCwd, sessionId);
      return gate.ok;
    },
  };
}

// Bounded prompt size for the aux-CLI conflict resolution. Beyond this the
// one-shot text model cannot reliably reproduce full files — fail over to the
// unresolved path (conflict task / manual) instead of risking a mangled merge.
const MAX_CONFLICT_PROMPT_CHARS = 160_000;

/** Delimiters the aux CLI must echo around each resolved file. */
const FILE_BLOCK_RE = /<<<RAPITAS_FILE:\s*(.+?)\s*>>>\r?\n([\s\S]*?)