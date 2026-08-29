/**
 * GitOperations — Worktree Guard
 *
 * Single source of truth for "is this the PRIMARY git working tree?" and a guard
 * that REFUSES agent git mutations on it. Agent commits / branch switches must
 * run in a dedicated `git worktree`; if they run on the primary checkout they
 * stage and commit the developer's own uncommitted work (`git add -A`), and the
 * pre-commit hook's lint-staged stash + a branch checkout can strand that work
 * in a dangling stash. This actually happened (see the main-checkout clobber
 * incident). Refusing fails safe — the task errors with a clear cause instead of
 * destroying work.
 */
import { exec } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { promisify } from 'util';
import { createLogger } from '../../../../../config/logger';
import { clearGitCache, execGitReadonly } from '../core/git-exec';

const execAsync = promisify(exec);

const logger = createLogger('git-operations/worktree-guard');

/**
 * Three-way worktree classification. `undetermined` means detection failed and
 * the guard must fail safe (refuse the operation) — but callers can now report
 * the TRUE cause (e.g. a vanished worktree directory) instead of claiming the
 * path is the primary checkout, which hid real failures behind a reassuring
 * "safety mechanism worked" message (task 601: 10 concerns unread for 5 days).
 */
type WorktreeDetection =
  | { kind: 'primary' }
  | { kind: 'worktree' }
  | { kind: 'undetermined'; reason: unknown; pathMissing: boolean };

/**
 * Classify a directory as primary checkout / linked worktree / undetermined.
 * A linked worktree has git-dir (`.git/worktrees/<name>`) != git-common-dir
 * (the shared `.git`); the primary tree has them equal. A missing directory is
 * detected BEFORE running git — "directory does not exist" and "primary
 * checkout" are entirely different failures and must not share a message.
 */
async function detectWorktreeKind(workingDirectory: string): Promise<WorktreeDetection> {
  if (!existsSync(workingDirectory)) {
    const reason = new Error(`Working directory does not exist: ${workingDirectory}`);
    logger.warn(
      { workingDirectory },
      '[worktree-guard] Working directory does not exist; treating as undetermined (fail safe)',
    );
    return { kind: 'undetermined', reason, pathMissing: true };
  }
  try {
    const [gitDir, commonDir] = await Promise.all([
      execGitReadonly('git rev-parse --absolute-git-dir', { cwd: workingDirectory }),
      execGitReadonly('git rev-parse --git-common-dir', { cwd: workingDirectory }),
    ]);
    const normalize = (p: string) => p.trim().replace(/\\/g, '/').replace(/\/+$/, '');
    let common = normalize(commonDir.stdout);
    // --git-common-dir is relative to the CWD (e.g. ".git" at the root, "../.git"
    // from a subdir like rapitas-backend); resolve it against workingDirectory so
    // ".." segments collapse — NOT against show-toplevel, which left "<root>/../.git"
    // un-normalized and made isPrimaryWorkTree wrongly return false from a subdir.
    if (!/^([a-zA-Z]:)?\//.test(common)) {
      common = normalize(resolve(workingDirectory, common));
    }
    return normalize(gitDir.stdout) === common ? { kind: 'primary' } : { kind: 'worktree' };
  } catch (error) {
    logger.warn(
      { err: error, workingDirectory },
      '[worktree-guard] Could not determine worktree type; treating as primary (fail safe)',
    );
    return { kind: 'undetermined', reason: error, pathMissing: false };
  }
}

/**
 * Whether a directory is the PRIMARY git working tree (not a linked worktree).
 *
 * @param workingDirectory - Directory to test. / 判定対象ディレクトリ
 * @returns true on the primary tree, or when detection fails (fail safe). / プライマリなら true（判定失敗時も安全側でtrue）
 */
export async function isPrimaryWorkTree(workingDirectory: string): Promise<boolean> {
  // NOTE: `undetermined` maps to true here on purpose — boolean callers
  // (pr-merge-ops, revert-ops, etc.) only use this to skip/refuse on the safe
  // side and do not need to distinguish the undetermined case.
  return (await detectWorktreeKind(workingDirectory)).kind !== 'worktree';
}

/** Fixed refusal message for a confirmed primary checkout (wording unchanged). */
function primaryRefusalMessage(op: string, workingDirectory: string): string {
  return (
    `Refusing to ${op} in the PRIMARY git working tree (${workingDirectory}). ` +
    'Agent git operations must run in a dedicated worktree — doing this on the ' +
    "primary checkout would stage/commit or clobber the developer's uncommitted work."
  );
}

/**
 * Throw if `workingDirectory` is the primary working tree — or if its worktree
 * type could not be determined (fail safe: still refuse, but say WHY). Use
 * before any agent git mutation (commit / branch create / branch switch) so it
 * never clobbers the developer's checkout.
 *
 * @param workingDirectory - Directory the mutation would run in. / 操作対象ディレクトリ
 * @param op - Short label of the operation (for the error). / 操作名（エラー用）
 * @param isPrimary - Test-only injectable probe. When provided, the legacy
 *   boolean path is used and the error is always the PRIMARY wording; only the
 *   default (omitted) path distinguishes undetermined causes. / テスト専用の注入経路（省略時のみ判定不能メッセージが分岐する）
 * @throws {Error} When the directory is the primary working tree, or its type
 *   is undetermined (path missing / git failure — the original cause is in the
 *   message and `cause`). / プライマリまたは判定不能の場合
 */
export async function ensureNotPrimaryWorkTree(
  workingDirectory: string,
  op: string,
  isPrimary?: (dir: string) => Promise<boolean>,
): Promise<void> {
  if (isPrimary !== undefined) {
    if (await isPrimary(workingDirectory)) {
      throw new Error(primaryRefusalMessage(op, workingDirectory));
    }
    return;
  }
  const detection = await detectWorktreeKind(workingDirectory);
  if (detection.kind === 'worktree') return;
  if (detection.kind === 'primary') {
    throw new Error(primaryRefusalMessage(op, workingDirectory));
  }
  const { reason, pathMissing } = detection;
  const reasonText = reason instanceof Error ? reason.message : String(reason);
  throw new Error(
    `Refusing to ${op}: could not determine the worktree type of ` +
      `${workingDirectory}${pathMissing ? ' — the directory does not exist' : ''} ` +
      '(fail safe: refusing the git operation). This is NOT a confirmed primary ' +
      `checkout — the worktree may have vanished or the path may be invalid. Cause: ${reasonText}`,
    { cause: reason },
  );
}

/**
 * Resolve the absolute, normalized git-common-dir for a directory (the shared
 * `.git` of a repo and all its linked worktrees). Returns null on failure.
 *
 * @param workingDirectory - Directory inside a git repo. / git リポジトリ内のディレクトリ
 * @returns Normalized common dir, or null. / 正規化済み common dir、失敗時 null
 */
async function gitCommonDir(workingDirectory: string): Promise<string | null> {
  try {
    const normalize = (p: string) => p.trim().replace(/\\/g, '/').replace(/\/+$/, '');
    const commonDir = await execGitReadonly('git rev-parse --git-common-dir', {
      cwd: workingDirectory,
    });
    let common = normalize(commonDir.stdout);
    if (!/^([a-zA-Z]:)?\//.test(common)) {
      const root = await execGitReadonly('git rev-parse --show-toplevel', {
        cwd: workingDirectory,
      });
      common = normalize(`${normalize(root.stdout)}/${common}`);
    }
    return common;
  } catch {
    return null;
  }
}

/**
 * Whether `workingDirectory` is the PRIMARY working tree of the SAME repository
 * the backend itself runs from (process.cwd()). True only for the rapitas
 * self-development checkout — NOT for other themes' repos and NOT for linked
 * worktrees of the self repo. Running an agent here lets its git commands switch
 * the dev backend's branch (the recurring main-checkout clobber), so callers must
 * refuse and require a worktree instead.
 *
 * @param workingDirectory - Directory the agent would run in. / エージェントの実行ディレクトリ
 * @returns true when it is the backend's own primary checkout. / backend自身のprimaryなら true
 */
export async function isBackendPrimaryCheckout(workingDirectory: string): Promise<boolean> {
  if (!(await isPrimaryWorkTree(workingDirectory))) return false;
  const [dirCommon, backendCommon] = await Promise.all([
    gitCommonDir(workingDirectory),
    gitCommonDir(process.cwd()),
  ]);
  return dirCommon != null && backendCommon != null && dirCommon === backendCommon;
}

/**
 * One unresolved-index state git can leave a worktree in, and how to clear it.
 * `headRef` is the ref file git creates while the operation is in progress;
 * `abortCmd` is the corresponding abort command.
 */
const UNRESOLVED_STATES: ReadonlyArray<{ headRef: string; abortCmd: string; label: string }> = [
  { headRef: 'MERGE_HEAD', abortCmd: 'git merge --abort', label: 'MERGE_HEAD' },
  // task 743: a killed/failed cherry-pick leaves CHERRY_PICK_HEAD with the same
  // unresolved-index symptom ("you need to resolve your current index first")
  // that MERGE_HEAD produces, but the MERGE_HEAD-only check above never caught it.
  { headRef: 'CHERRY_PICK_HEAD', abortCmd: 'git cherry-pick --abort', label: 'CHERRY_PICK_HEAD' },
];

/**
 * Detect and clear a stuck `MERGE_HEAD` or `CHERRY_PICK_HEAD` (unresolved
 * merge/cherry-pick state) left in a worktree, so a subsequent `git checkout`
 * / `git add` / `git commit` never fails with git's `error: you need to
 * resolve your current index first`. This state is left behind when
 * `pre-pr-base-sync.ts`'s own `merge --abort` fails or never runs (e.g. the
 * process is killed mid-merge/mid-cherry-pick) — with nothing else clearing
 * it, the worktree stays permanently wedged (task 691, widened to
 * CHERRY_PICK_HEAD in task 743).
 *
 * NOTE: The `logger.error(...)` call in the catch block below (this file,
 * "Detected unresolved <state> but abort failed") is the source of the task
 * 731 ERROR log ("Command failed: git merge --abort" / "fatal: There is no
 * merge to abort (MERGE_HEAD missing)"). Root cause: the headRef check above
 * goes through `execGitReadonly`'s TTL cache (default 30s, see
 * ../core/git-exec.ts). Aborting changes real git state without touching that
 * cache, so a second call for the same directory within the TTL window (e.g.
 * createBranch followed by createCommit in workflow-auto-commit.ts) would see
 * the stale "head ref exists" result and retry the abort, which then fails
 * with git's "There is no merge/cherry-pick to abort" — a false-positive
 * ERROR log for an already-recovered worktree. Clearing the cache for this
 * directory right after a successful abort keeps the next check honest.
 *
 * @param workingDirectory - Directory to check and, if needed, recover. / 確認・復旧対象ディレクトリ
 * @returns true when an unresolved merge/cherry-pick was found and aborted. / 未解決マージ/cherry-pickを検知しabortした場合true
 */
export async function recoverFromUnresolvedMerge(workingDirectory: string): Promise<boolean> {
  for (const state of UNRESOLVED_STATES) {
    try {
      await execGitReadonly(`git rev-parse --verify -q ${state.headRef}`, {
        cwd: workingDirectory,
      });
    } catch {
      // This head ref is absent — nothing to recover for this state.
      continue;
    }
    try {
      await execAsync(state.abortCmd, { cwd: workingDirectory });
      clearGitCache(workingDirectory);
      logger.warn(
        { workingDirectory },
        `[worktree-guard] Found unresolved ${state.label}; aborted it to unblock the git operation`,
      );
      return true;
    } catch (error) {
      // See the JSDoc NOTE above: this trip reflects a genuine abort failure
      // (the TTL-cache false-positive scenario is prevented by the
      // clearGitCache(workingDirectory) call on the success path above).
      logger.error(
        { err: error, workingDirectory },
        `[worktree-guard] Detected unresolved ${state.label} but ${state.abortCmd} failed`,
      );
      return false;
    }
  }
  return false;
}

/** Internal exec type used by findConflictingWorktreeForBranch (injectable for tests). */
type WorktreeExecFn = (cmd: string, opts: { cwd: string }) => Promise<{ stdout: string }>;

/**
 * Find a worktree OTHER than `workingDirectory` that is currently using `branchName`.
 * Returns the conflicting worktree path, or null when there is no conflict.
 *
 * Porcelain output is blank-line-separated blocks:
 *   worktree <path>
 *   HEAD <sha>
 *   branch refs/heads/<name>
 *
 * Use `resolve()` to normalise Windows paths (C:/ vs C:\, trailing separators)
 * before comparing — same logic as the inline check it replaces in createBranch.
 *
 * @param workingDirectory - Current worktree directory / 現在の作業ディレクトリ
 * @param branchName - Branch name to check / チェックするブランチ名
 * @param execFn - Exec function (injectable for tests) / exec関数（テスト用に差し替え可能）
 * @returns Conflicting worktree path, or null / 競合worktreeのパス。競合なし・失敗時はnull
 */
export async function findConflictingWorktreeForBranch(
  workingDirectory: string,
  branchName: string,
  execFn: WorktreeExecFn = execAsync as WorktreeExecFn,
): Promise<string | null> {
  // Prune stale entries before checking — same pattern as createBranch.
  await execFn('git worktree prune', { cwd: workingDirectory }).catch(() => {});
  try {
    const { stdout: worktreeList } = await execFn('git worktree list --porcelain', {
      cwd: workingDirectory,
    });
    const blocks = worktreeList.split(/\n\n+/);
    for (const block of blocks) {
      if (block.includes(`branch refs/heads/${branchName}`)) {
        const pathLine = block.split('\n').find((l) => l.startsWith('worktree '));
        if (pathLine) {
          const wtPath = pathLine.slice('worktree '.length).trim();
          // NOTE: Use resolve() to normalise Windows paths before comparing.
          // Only block when it is a DIFFERENT worktree — the current directory
          // already on this branch is a checkout no-op, not a conflict.
          if (resolve(wtPath) !== resolve(workingDirectory)) {
            return wtPath;
          }
        }
      }
    }
    return null;
  } catch {
    // NOTE: If worktree list fails, return null (fail-safe). The caller falls
    // through to the git operation and lets git report any real error.
    return null;
  }
}
