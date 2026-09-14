/**
 * VerifyPhaseSnapshot
 *
 * Protects the implementer's uncommitted work from destructive git operations
 * run by a verifier/auto_verifier CLI phase (task 913 incident: a verifier's
 * `git checkout -- <file>` discarded the implementer's uncommitted diff). Takes
 * a non-destructive git tag snapshot immediately before the verifier starts and
 * reconciles tracked-file content against it after the phase ends (success,
 * failure, or timeout), restoring tracked files whose divergence matches the
 * fingerprint of a destructive git reset while preserving files that look
 * like the implementer's own continued editing (see reconcileVerifySnapshot's
 * JSDoc for the HEAD-comparison heuristic). Not responsible for deciding the
 * resulting workflowStatus on an unrecoverable reconcile — see
 * workflow-cli-executor-verify-gate.ts.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../../config/logger';
import { recordTransition, type TransitionActor } from './transition-recorder';
import { writeBlockedStatusDurable } from './durable-blocked-write';
import type { RoleTransition, WorkflowAdvanceResult } from './workflow-types';

const execFileAsync = promisify(execFile);
const log = createLogger('workflow:verify-phase-snapshot');

// Local git reads/writes normally finish in well under a second; mirrors the
// budget used by worktree-remove.ts's GIT_OP_TIMEOUT_MS.
const GIT_OP_TIMEOUT_MS = 60_000;
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Tag namespace for verify-phase snapshots — kept distinct from
 * worktree-rebuild-recovery.ts's `recovery/task-*` tags (different purpose,
 * different recovery path; research.md リスク評価 flagged the collision risk).
 */
export const VERIFY_SNAPSHOT_TAG_PREFIX = 'verify-snapshot/task-';

/** WorkflowTransition.cause recorded when reconcile cannot prove preservation. */
export const VERIFY_SNAPSHOT_RESTORE_FAILED_CAUSE = 'VERIFY_SNAPSHOT_RESTORE_FAILED';

export interface VerifySnapshotHandle {
  tagName: string;
  sha: string;
}

export type ReconcileResult =
  | { status: 'clean' }
  | { status: 'restored'; restoredFiles: string[]; preservedDivergentFiles: string[] }
  | { status: 'preserved'; preservedFiles: string[] }
  | { status: 'unrecoverable'; reason: string };

interface GitRunResult {
  stdout: string;
  code: number;
}

/**
 * Run a git command, capturing a non-zero exit code instead of throwing so
 * callers can distinguish "command ran and reported no/some diff" from
 * "command itself failed" (bad ref, git internal error).
 *
 * @param cwd - Directory to run in / 実行ディレクトリ
 * @param args - git argv / git引数
 * @returns stdout and exit code / 標準出力と終了コード
 */
async function runGit(cwd: string, args: string[]): Promise<GitRunResult> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: GIT_OP_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
    });
    return { stdout, code: 0 };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { code?: number | string; stdout?: string };
    if (typeof e.code === 'number') return { stdout: e.stdout ?? '', code: e.code };
    throw err;
  }
}

/**
 * Snapshot the worktree's current content (tracked + untracked) as a
 * non-destructive git tag. Never alters the working tree or leaves the index
 * staged. Failure is non-fatal by design — a null return means the caller
 * proceeds WITHOUT protection for this run (fail-open on setup so a snapshot
 * hiccup never blocks the verifier from starting; the gate that matters is at
 * reconcile time — see reconcileVerifySnapshot).
 *
 * @param worktreePath - Worktree to snapshot / スナップショット対象
 * @param taskId - Task under verification / 対象タスク
 * @returns Snapshot handle, or null on failure / スナップショット情報（失敗時null）
 */
export async function takeVerifySnapshot(
  worktreePath: string,
  taskId: number,
): Promise<VerifySnapshotHandle | null> {
  // Fail fast instead of letting execFile spend its 60s timeout budget per
  // git call against a directory that was never created (or already torn
  // down) — a missing .git also means there is nothing to protect here.
  if (!existsSync(worktreePath) || !existsSync(join(worktreePath, '.git'))) {
    log.warn(
      { taskId, worktreePath },
      '[verify-phase-snapshot] Worktree missing — skipping snapshot',
    );
    return null;
  }
  // taskId flows straight into an argv element passed to execFile (no shell),
  // but it is still validated as a defense-in-depth boundary — the tag is
  // entirely our own construction otherwise (prefix + taskId + Date.now()).
  if (!Number.isInteger(taskId) || taskId <= 0) {
    log.warn(
      { taskId, worktreePath },
      '[verify-phase-snapshot] Invalid taskId — skipping snapshot',
    );
    return null;
  }
  const tagName = `${VERIFY_SNAPSHOT_TAG_PREFIX}${taskId}-${Date.now()}`;
  let staged = false;
  try {
    // Stage first: `git stash create` only captures TRACKED changes, so a
    // brand-new (untracked) implementer file would be invisible to the
    // snapshot commit without staging it (mirrors worktree-rebuild-recovery.ts).
    await execFileAsync('git', ['add', '-A'], { cwd: worktreePath, timeout: GIT_OP_TIMEOUT_MS });
    staged = true;
    const stash = await execFileAsync('git', ['stash', 'create'], {
      cwd: worktreePath,
      encoding: 'utf8',
      timeout: GIT_OP_TIMEOUT_MS,
    });
    let sha = stash.stdout.trim();
    if (!sha) {
      // Clean tree (nothing to stash) — snapshot = HEAD.
      const head = await execFileAsync('git', ['rev-parse', 'HEAD'], {
        cwd: worktreePath,
        encoding: 'utf8',
        timeout: GIT_OP_TIMEOUT_MS,
      });
      sha = head.stdout.trim();
    }
    await execFileAsync('git', ['tag', tagName, sha], {
      cwd: worktreePath,
      timeout: GIT_OP_TIMEOUT_MS,
    });
    log.info({ taskId, tagName, sha }, '[verify-phase-snapshot] Snapshot tag created');
    return { tagName, sha };
  } catch (err) {
    log.warn(
      { err, taskId, tagName },
      '[verify-phase-snapshot] Snapshot failed — proceeding without protection for this run',
    );
    return null;
  } finally {
    // Unstage whatever `git add -A` staged (success or failure alike) — the
    // snapshot attempt must never leave the index in a state the verifier
    // wouldn't otherwise see via `git status` (検証懸念1: a stash-create/tag
    // failure previously left `git add -A`'s staging in place).
    if (staged) {
      await execFileAsync('git', ['reset'], {
        cwd: worktreePath,
        timeout: GIT_OP_TIMEOUT_MS,
      }).catch(() => {});
    }
  }
}

/**
 * Restore each listed tracked file to its snapshot-time content, byte for
 * byte (git checkout reads the blob directly from the object store, so no
 * CRLF/LF or encoding conversion is applied beyond the repo's own checkout
 * rules — matching the rules that were in effect when the snapshot was taken).
 *
 * @param worktreePath - Worktree to restore into / 復元対象worktree
 * @param tagName - Snapshot tag to restore from / 復元元スナップショットタグ
 * @param files - Tracked file paths that diverged / 復元対象ファイル
 * @returns The files actually restored / 復元されたファイル一覧
 */
export async function restoreTrackedFiles(
  worktreePath: string,
  tagName: string,
  files: string[],
): Promise<string[]> {
  const restored: string[] = [];
  for (const file of files) {
    await execFileAsync('git', ['checkout', tagName, '--', file], {
      cwd: worktreePath,
      timeout: GIT_OP_TIMEOUT_MS,
    });
    restored.push(file);
  }
  return restored;
}

/**
 * List the commits (on the current branch's ancestry, newest first) that
 * touched `relPath`, via `git log --format=%H -- <relPath>` — deliberately
 * WITHOUT `--all`, so an unrelated branch's past content can never be
 * mistaken for this branch's own history (§プレモーテム#1).
 *
 * @param worktreePath - Worktree to inspect / 対象worktree
 * @param relPath - Path relative to the worktree root / worktree相対パス
 * @returns Commit SHAs newest-first, or null on a git failure / SHA一覧（新しい順）、gitエラー時null
 */
async function listCommitsTouchingPath(
  worktreePath: string,
  relPath: string,
): Promise<string[] | null> {
  const log_ = await runGit(worktreePath, ['log', '--format=%H', '--', relPath]);
  if (log_.code !== 0) return null;
  return log_.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Compare the worktree's tracked-file content against a prior snapshot tag
 * and restore files that carry the fingerprint of a destructive verifier
 * operation, while preserving files that look like legitimate continued
 * editing. A verifier's destructive git operation (`checkout --`, `reset
 * --hard <any-ancestor-commit>`) always resets a tracked file to the exact
 * blob content of SOME commit already reachable on this branch — that is its
 * distinguishing fingerprint, since neither command can produce any content
 * that never existed in the file's own commit history. So for each file that
 * diverged from the snapshot tag, this walks every commit that ever touched
 * that path (`listCommitsTouchingPath`, newest first) and checks whether the
 * file's CURRENT content matches ANY of them (`git diff --quiet <sha> --
 * <file>`), stopping at the first match: a match is restored from the tag
 * (受入基準1 — undo the destructive reset, including `reset --hard` to an
 * ancestor OTHER than HEAD, which a HEAD-only comparison would miss); no
 * match across the whole history means the current content is something the
 * file has never been before — most plausibly the implementer's own
 * continued edit — so it is left untouched and reported as preserved
 * (受入基準3 — never overwrite a legitimate concurrent edit with the old
 * snapshot). A path absent from both a given commit and the snapshot tag's
 * working state trivially "matches" that commit (both sides empty) and is
 * restored — this correctly recreates a brand-new untracked file the
 * snapshot captured that a verifier's `git clean -fd` then deleted, and
 * covers a file the verifier deleted outright via `checkout` to a commit
 * that predates the file's existence. New (untracked) files that were never
 * captured by the snapshot are never touched at all: `git diff --name-only
 * <tag>` only reports paths that exist in the snapshot tree.
 *
 * NOTE on reuse (検証懸念2, confirmed unchanged in this revision): plan.md's
 * 設計判断の根拠 evaluated importing worktree-preservation.ts's
 * `isWorktreeContentPreserved()` here and rejected it — calling it WITHOUT a
 * tag only proves "no difference from HEAD/index", which is exactly the
 * false-clean case above (post-`checkout --` content trivially matches HEAD);
 * calling it WITH a tag requires the `recovery/task-\d+-\d+` pattern, not
 * this module's `verify-snapshot/task-*` tags. `worktree-preservation.ts` is
 * left untouched; this module keeps its own self-contained git diff/checkout
 * implementation.
 *
 * @param worktreePath - Worktree to reconcile / 対象worktree
 * @param tagName - Snapshot tag from takeVerifySnapshot / スナップショットタグ
 * @returns Reconcile outcome / 照合結果
 */
export async function reconcileVerifySnapshot(
  worktreePath: string,
  tagName: string,
): Promise<ReconcileResult> {
  try {
    const diffNames = await runGit(worktreePath, ['diff', '--name-only', tagName, '--']);
    if (diffNames.code !== 0) {
      return {
        status: 'unrecoverable',
        reason: `git diff --name-only failed (exit ${diffNames.code}): ${diffNames.stdout.slice(0, 500)}`,
      };
    }
    const changedFiles = diffNames.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (changedFiles.length === 0) return { status: 'clean' };

    // Classify each diverged file: does its CURRENT content match ANY commit
    // in that file's own history (the fingerprint of `checkout --` /
    // `reset --hard <ancestor>`, HEAD included)?
    const restoreCandidates: string[] = [];
    const preservedDivergentFiles: string[] = [];
    for (const file of changedFiles) {
      const shas = await listCommitsTouchingPath(worktreePath, file);
      if (shas === null) {
        return {
          status: 'unrecoverable',
          reason: `git log failed to list commits touching ${file}`,
        };
      }
      let matchedHistory = false;
      if (shas.length === 0) {
        // Never committed on this branch (a brand-new file the snapshot
        // captured only via `git stash create`'s staging). No commit exists
        // to compare against, so the only possible "reset" fingerprint is
        // deletion (e.g. a verifier's `git clean -fd`) — content the file
        // never had cannot be produced by any git checkout/reset operation.
        matchedHistory = !existsSync(join(worktreePath, file));
      }
      for (const sha of shas) {
        const shaDiff = await runGit(worktreePath, ['diff', '--quiet', sha, '--', file]);
        if (shaDiff.code === 0) {
          matchedHistory = true;
          break;
        }
        if (shaDiff.code !== 1) {
          return {
            status: 'unrecoverable',
            reason: `git diff --quiet ${sha} failed for ${file} (exit ${shaDiff.code}): ${shaDiff.stdout.slice(0, 500)}`,
          };
        }
      }
      if (matchedHistory) {
        restoreCandidates.push(file);
      } else {
        preservedDivergentFiles.push(file);
      }
    }

    if (preservedDivergentFiles.length > 0) {
      log.info(
        { worktreePath, tagName, preservedDivergentFiles },
        "[verify-phase-snapshot] Detected continued editing on diverged file(s) (content matches no commit in the file's history) — preserving, not restoring",
      );
    }

    if (restoreCandidates.length === 0) {
      return { status: 'preserved', preservedFiles: preservedDivergentFiles };
    }

    const restoredFiles = await restoreTrackedFiles(worktreePath, tagName, restoreCandidates);
    log.warn(
      { worktreePath, tagName, restoredFiles, preservedDivergentFiles },
      '[verify-phase-snapshot] Tracked-file diff matching prior commit history detected after verify phase — restored from snapshot',
    );
    return { status: 'restored', restoredFiles, preservedDivergentFiles };
  } catch (err) {
    return {
      status: 'unrecoverable',
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Close the completion gate when a verify-phase snapshot reconcile could not
 * prove the implementer's work was preserved (受入基準2). Differs from an
 * ordinary hard-fail block: it always wins over verify.md's own content
 * (regardless of whether verify.md was even saved — a crash/timeout before
 * saving must still close the gate), so callers should check this BEFORE any
 * other verify-outcome branching.
 *
 * @param params - Task/transition/session context and the unrecoverable reason / タスク・遷移・セッション情報と比較不能の理由
 * @returns The fallback workflowStatus recorded / 差し戻し先のworkflowStatus
 */
export async function closeGateForUnrecoverableSnapshot(params: {
  taskId: number;
  transition: Pick<RoleTransition, 'role'>;
  session: { id: number };
  currentWfStatus: string;
  reason: string;
}): Promise<WorkflowAdvanceResult['status']> {
  const { taskId, transition, session, currentWfStatus, reason } = params;
  const fallbackStatus: WorkflowAdvanceResult['status'] = 'plan_approved';
  log.error(
    { taskId, reason },
    '[verify-phase-snapshot] Snapshot reconcile unrecoverable — closing completion gate',
  );
  await recordTransition({
    taskId,
    fromStatus: currentWfStatus,
    toStatus: fallbackStatus,
    actor: transition.role as TransitionActor,
    cause: VERIFY_SNAPSHOT_RESTORE_FAILED_CAUSE,
    phase: 'verify',
    sessionId: session.id,
    metadata: { reason },
    invariantViolation: true,
    invariantMessage: `検証フェーズのスナップショット照合が失敗し、実装成果の保持を確認できませんでした: ${reason}`,
  });
  await writeBlockedStatusDurable({
    taskId,
    log,
    source: 'WorkflowCLIExecutor',
    notification: {
      title: '検証フェーズのスナップショット復元に失敗',
      message: `タスク #${taskId} の検証フェーズでスナップショット照合が失敗しました。手動確認が必要です。`,
    },
  });
  await notifyVerifySnapshotRestoreFailed(taskId, reason);
  return fallbackStatus;
}

/**
 * Best-effort user notification for a reconcile that could not prove the
 * implementer's work was preserved (受入基準2). Dynamic import avoids a
 * routes/services import cycle (mirrors worktree-rebuild-recovery.ts's
 * notifyRecoveryFallbackBlocked). Never throws.
 *
 * @param taskId - Blocked task / ブロックされたタスク
 * @param reason - Why reconcile could not run / 比較不能の理由
 */
export async function notifyVerifySnapshotRestoreFailed(
  taskId: number,
  reason: string,
): Promise<void> {
  try {
    const { createNotification } = await import('../communication/notification-service');
    await createNotification({
      type: 'system',
      title: '検証フェーズのスナップショット復元に失敗',
      message: `タスク #${taskId} の検証フェーズ終了後、実装成果の保持を確認できませんでした（${reason}）。手動確認が必要です。`,
      link: `/tasks?taskId=${taskId}`,
      metadata: { taskId, reason: 'verify_snapshot_restore_failed', detail: reason },
    });
  } catch (err) {
    log.warn({ err, taskId }, '[verify-phase-snapshot] Failed to create notification (non-fatal)');
  }
}
