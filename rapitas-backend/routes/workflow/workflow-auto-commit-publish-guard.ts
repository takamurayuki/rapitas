/**
 * Workflow Auto Commit — publish guard
 *
 * Runs between a passed verification gate and the push/PR step: the pre-PR
 * base sync (fetch + merge origin/<base>, conflict resolution) and, whenever
 * that sync moved HEAD, a full re-run of the required gate on the final code
 * so the revision pushed is exactly the revision verified. Not responsible
 * for the commit itself or for creating the PR.
 */
import { createLogger } from '../../config/logger';
import { runVerificationGate } from '../../services/agents/verification/verification-gate';
import { notify } from '../../services/workflow/auto-merge-notify';
import { syncBaseIntoBranch, type BaseSyncResult } from '../../services/workflow/pre-pr-base-sync';
import { listWorkingTreeChanges, readHeadRevision } from './workflow-auto-commit-presave';

const log = createLogger('routes:workflow:auto-commit:publish-guard');

/** Outcome of the sync + re-verify step. */
export interface PublishGuardResult {
  /** True when the current HEAD is verified and may be pushed. */
  ok: boolean;
  baseSync: BaseSyncResult;
  /** HEAD that the (re-)verification covered. */
  verifiedRevision: string | null;
  /** HEAD after the sync — must equal verifiedRevision to publish. */
  headRevision: string | null;
  /** True when the gate ran again on the synced code. */
  reverified: boolean;
  /** Uncommitted/untracked paths found when they would have desynced verified vs published. */
  dirtyPaths?: string[];
  verificationBlocked?: boolean;
  verificationUnverifiable?: boolean;
  /** Fixed sentence (no raw git output) safe for completion classification. */
  error?: string;
}

/**
 * Merge origin/<base> into the task branch and re-verify the final code when
 * the merge changed anything. Withholds publication on unresolved conflicts,
 * a failed re-verification, or a HEAD that differs from the verified one.
 *
 * @param p - Task, worktree, base branch, session and the HEAD the gate verified / 入力
 * @returns Whether HEAD may be published, with the sync and verification facts / 結果
 */
export async function syncAndReverifyBeforePublish(p: {
  taskId: number;
  gitCwd: string;
  baseBranch: string;
  sessionId?: number;
  verifiedRevision: string | null;
}): Promise<PublishGuardResult> {
  const { taskId, gitCwd, baseBranch } = p;
  // The gate verified the WORKING TREE; a push publishes HEAD. Anything left
  // uncommitted or untracked after the gate (the verifier CLI is still alive
  // when verify.md is saved) means the two differ — hold, publish nothing.
  const dirtyBefore = await listWorkingTreeChanges(gitCwd);
  if (dirtyBefore === null || dirtyBefore.length > 0) {
    log.warn(
      { taskId, dirty: dirtyBefore?.slice(0, 20) ?? 'unknown' },
      '[Workflow] working tree differs from HEAD after the gate — refusing to publish',
    );
    return {
      ok: false,
      baseSync: { status: 'skipped', changedFiles: 0, conflicts: [], detail: 'dirty tree' },
      verifiedRevision: p.verifiedRevision,
      headRevision: await readHeadRevision(gitCwd),
      reverified: false,
      dirtyPaths: dirtyBefore ?? [],
      error:
        '検証後に未コミット・未追跡の変更が残っているため、検証した内容と異なる状態を公開しないよう push/PR を中止しました。',
    };
  }
  const baseSync = await syncBaseIntoBranch({
    gitCwd,
    baseBranch,
    taskId,
    sessionId: p.sessionId,
  }).catch((err): BaseSyncResult => {
    log.warn({ err, taskId }, '[Workflow] base sync threw — treating as skipped (fail-open)');
    return { status: 'skipped', changedFiles: 0, conflicts: [], detail: String(err) };
  });
  const out: PublishGuardResult = {
    ok: false,
    baseSync,
    verifiedRevision: p.verifiedRevision,
    headRevision: null,
    reverified: false,
  };

  if (baseSync.status === 'conflict_unresolved' || baseSync.status === 'reverify_failed') {
    // Withhold the PR; keep the worktree (NO cleanup) as the backstop for the
    // conflict-task / AutoMergeWatcher defense line and for a re-run.
    if (baseSync.status === 'reverify_failed') {
      out.verificationBlocked = true;
      out.error = `base(${baseBranch})取り込み後の再検証に失敗したため、auto-PRを中止しました。`;
    } else {
      out.error = `base(${baseBranch})とのマージ競合を自動解消できなかったため、auto-PRを中止しました。`;
    }
    await notify({
      taskId,
      type:
        baseSync.status === 'conflict_unresolved'
          ? 'base_sync_conflict_unresolved'
          : 'base_sync_reverify_failed',
      title:
        baseSync.status === 'conflict_unresolved'
          ? 'PR作成前のbase取り込みで競合を解消できませんでした'
          : 'base取り込み後の再検証に失敗しました',
      message:
        baseSync.status === 'conflict_unresolved'
          ? `タスク ${taskId}: ${baseSync.detail}。対象: ${baseSync.conflicts.join(', ').slice(0, 500)}。PRは作成していません。手動確認または再実行してください。`
          : `タスク ${taskId}: ${baseSync.detail}。PRは作成していません。`,
    });
    log.warn({ taskId, baseSync }, '[Workflow] pre-PR base sync blocked PR creation');
    return out;
  }

  out.headRevision = await readHeadRevision(gitCwd);
  const moved = out.headRevision !== null && out.headRevision !== p.verifiedRevision;
  if (moved || baseSync.changedFiles > 0) {
    // The gate's lint/typecheck/test/runtime verdict covered the pre-merge
    // tree; a merge (even a clean one) is new code. Verify the final code.
    log.info(
      {
        taskId,
        verified: p.verifiedRevision,
        head: out.headRevision,
        changed: baseSync.changedFiles,
      },
      '[Workflow] base sync moved HEAD — re-running the verification gate on the final code',
    );
    const regate = await runVerificationGate(taskId, gitCwd, p.sessionId);
    out.reverified = true;
    if (!regate.ok) {
      out.verificationBlocked = true;
      out.verificationUnverifiable = regate.result?.unverifiable === true || regate.result === null;
      out.error = `自動検証に失敗しました（${regate.result?.summary ?? 'lint/型エラー'}）。base 取り込み後の最終コードで再検証に失敗したため、push/PR を中止しました。`;
      return out;
    }
    out.verifiedRevision = out.headRevision;
  }

  // A merge (or its aux conflict resolution) must leave a clean tree too;
  // the re-gate above verified the working tree, the push ships HEAD.
  const dirtyAfter = await listWorkingTreeChanges(gitCwd);
  if (dirtyAfter === null || dirtyAfter.length > 0) {
    out.dirtyPaths = dirtyAfter ?? [];
    out.error =
      'base 取り込み後に未コミット・未追跡の変更が残っているため、検証した内容と異なる状態を公開しないよう push/PR を中止しました。';
    log.warn(
      { taskId, dirty: dirtyAfter?.slice(0, 20) ?? 'unknown' },
      '[Workflow] working tree differs from HEAD after the sync — refusing to publish',
    );
    return out;
  }
  if (out.headRevision === null || out.headRevision !== out.verifiedRevision) {
    out.error = `検証済みの版と HEAD が一致しないため、push/PR を中止しました。`;
    log.warn(
      { taskId, verified: out.verifiedRevision, head: out.headRevision },
      '[Workflow] refusing to publish an unverified revision',
    );
    return out;
  }
  out.ok = true;
  log.info(
    {
      taskId,
      baseSync: { ...baseSync, conflicts: baseSync.conflicts.length },
      head: out.headRevision,
    },
    '[Workflow] pre-PR base sync done — publishing the verified revision',
  );
  return out;
}
