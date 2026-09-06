/**
 * auto-merge-ci-failure
 *
 * Orchestrates the AutoMergeWatcher's response to a CI-red PR: try a cheap
 * base update first (BEHIND → `gh pr update-branch`, once per head SHA),
 * delegate real conflicts (DIRTY) back to the watcher's conflict handler,
 * treat a repair re-run that pushed nothing (head unchanged) as void, and
 * only then spend a bounded ci_repair bounce. NOT responsible for the DIRTY
 * conflict-task logic itself (injected from the watcher) nor for how CI log
 * excerpts are fetched (ci-self-repair owns that).
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { recordTransition } from './transition-recorder';
import { notify } from './auto-merge-notify';
import { markExhausted } from './auto-merge-exhaustion';
import { attemptCiRepair, CI_REPAIR_CAUSE } from './ci-self-repair';
import { readMergeState, readHeadSha, updatePrBranch } from './auto-merge-checks';
import type { Candidate } from './auto-merge-candidates';
import { readBaseFailingJobs, splitInheritedFailures } from './auto-merge-ci-attribution';

const log = createLogger('workflow:auto-merge-ci-failure');

/** WorkflowTransition.cause recording one update-branch attempt per head SHA. */
export const UPDATE_BRANCH_ATTEMPTED_CAUSE = 'auto_merge_update_branch_attempted';
/** Transition cause recorded when every failing check is inherited from the base branch. */
export const CI_INHERITED_HOLD_CAUSE = 'auto_merge_ci_inherited_hold';

/** Read the headSha recorded in a transition's metadata JSON. */
function parseHeadShaFromMetadata(metadata: string | null): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { headSha?: unknown };
    return typeof parsed.headSha === 'string' && parsed.headSha ? parsed.headSha : null;
  } catch {
    return null;
  }
}

/**
 * Whether an update-branch attempt was already recorded for this head SHA.
 * FAIL OPEN on a DB error (reads as "not attempted"): update-branch is
 * near-idempotent on GitHub's side, so a rare duplicate send during a DB
 * hiccup is harmless — unlike the repair budget, this is not a spend cap.
 */
async function hasAttemptedUpdateBranchFor(taskId: number, headSha: string): Promise<boolean> {
  const rows = await prisma.workflowTransition
    .findMany({
      where: { taskId, cause: UPDATE_BRANCH_ATTEMPTED_CAUSE },
      select: { metadata: true },
    })
    .catch(() => []);
  return rows.some((r) => parseHeadShaFromMetadata(r.metadata) === headSha);
}

/**
 * When the PR is BEHIND its base, run `gh pr update-branch` and report handled.
 * The branch update triggers a fresh CI run, so the next tick re-evaluates with
 * base drift ruled out — the failure that burned both repair attempts on
 * task 537 / PR #339 without ever being an implementation defect. Attempted at
 * most once per head SHA (headSha `'unknown'` when unreadable, so a gh outage
 * cannot re-send every tick); a repeat falls through to CI repair.
 */
async function attemptUpdateBranchIfBehind(c: Candidate): Promise<boolean> {
  const ghState = await readMergeState(c.cwd, c.prNumber);
  if (ghState !== 'BEHIND') return false;

  const headSha = (await readHeadSha(c.cwd, c.prNumber)) ?? 'unknown';
  if (await hasAttemptedUpdateBranchFor(c.taskId, headSha)) return false;

  const ok = await updatePrBranch(c.cwd, c.prNumber);
  await recordTransition({
    taskId: c.taskId,
    fromStatus: 'completed',
    toStatus: 'completed',
    actor: 'system',
    cause: UPDATE_BRANCH_ATTEMPTED_CAUSE,
    phase: 'verify',
    metadata: { headSha, ok, prNumber: c.prNumber },
  });
  log.info(
    { taskId: c.taskId, prNumber: c.prNumber, headSha, ok },
    '[auto-merge] CI failed on a BEHIND branch — updated branch with base, re-evaluating next tick',
  );
  return true;
}

/** The head SHA recorded by the most recent ci_repair bounce, if any. */
async function hasInheritedHoldFor(taskId: number, headSha: string): Promise<boolean> {
  const rows = await prisma.workflowTransition
    .findMany({
      where: { taskId, cause: CI_INHERITED_HOLD_CAUSE },
      select: { metadata: true },
    })
    .catch(() => []);
  return rows.some((r) => parseHeadShaFromMetadata(r.metadata) === headSha);
}

/**
 * Park a PR whose failing checks ALL fail on the base branch too. Nothing
 * inside the PR can turn them green, so a repair bounce would only burn an
 * implementer run and a budget slot (task 847, 2026-09-05: three bounces
 * against a grown line-limit baseline and red tests on develop). Recorded
 * once per head SHA; the BEHIND path re-evaluates once the base moves on.
 */
async function holdForInheritedFailures(c: Candidate, inherited: string[]): Promise<void> {
  const headSha = (await readHeadSha(c.cwd, c.prNumber)) ?? 'unknown';
  if (await hasInheritedHoldFor(c.taskId, headSha)) return;
  await recordTransition({
    taskId: c.taskId,
    fromStatus: 'completed',
    toStatus: 'completed',
    actor: 'system',
    cause: CI_INHERITED_HOLD_CAUSE,
    phase: 'verify',
    metadata: { headSha, prNumber: c.prNumber, baseBranch: c.baseBranch, inherited },
  });
  await notify({
    taskId: c.taskId,
    type: 'auto_merge_ci_inherited',
    title: '自動マージ保留（本線由来のCI失敗）',
    message: `PR #${c.prNumber} の失敗チェック（${inherited.join(', ')}）は本線 ${c.baseBranch} でも失敗しており、このPRの変更では直せません。本線が緑になった後にブランチを更新して再評価します。`,
  });
  log.info(
    { taskId: c.taskId, prNumber: c.prNumber, inherited, headSha },
    '[auto-merge] CI failures inherited from base — holding instead of bouncing ci_repair',
  );
}

async function lastCiRepairHeadSha(taskId: number): Promise<string | null> {
  const row = await prisma.workflowTransition
    .findFirst({
      where: { taskId, cause: CI_REPAIR_CAUSE },
      orderBy: { createdAt: 'desc' },
      select: { metadata: true },
    })
    .catch(() => null);
  return row ? parseHeadShaFromMetadata(row.metadata) : null;
}

/**
 * Whether the last ci_repair bounce ended without a push: the PR head is still
 * the SHA recorded at bounce time. Such a re-run was void — the implementer
 * found local checks green and had nothing to push (typically a CI-only
 * failure), so spending another repair attempt would repeat the same no-op.
 */
async function isNoDiffSinceLastRepair(c: Candidate): Promise<boolean> {
  const stored = await lastCiRepairHeadSha(c.taskId);
  if (!stored) return false;
  const current = await readHeadSha(c.cwd, c.prNumber);
  return current != null && current === stored;
}

/**
 * Handle a candidate whose blocking CI checks failed. Ordered: base update
 * (BEHIND), conflict delegation (DIRTY), void-repair park (no diff since the
 * last bounce), then a bounded ci_repair bounce with PR context for log
 * excerpts. Side effects: gh calls, WorkflowTransition rows, notifications.
 *
 * @param c - The auto-merge candidate whose CI failed. / CI失敗した候補
 * @param failedChecks - Names of the failing blocking checks. / 失敗チェック名
 * @param tryHandleConflict - The watcher's DIRTY-conflict handler; returns true
 *   when the conflict path handled this candidate. / 競合処理コールバック
 */
export async function handleCiFailure(
  c: Candidate,
  failedChecks: string[],
  tryHandleConflict: (c: Candidate, reason: string) => Promise<boolean>,
): Promise<void> {
  // Cheapest first: a BEHIND branch often fails CI purely from base drift —
  // pull base in and let the fresh CI run decide before spending anything.
  if (await attemptUpdateBranchIfBehind(c)) return;

  // A branch can be BOTH conflicting (DIRTY) AND CI-red at the same time —
  // typically because it forked from a base tip that has since moved on,
  // so it's both missing upstream fixes (real CI failures unrelated to the
  // task's own changes) and can't fast-forward merge. Attempting CI
  // self-repair alone in that case is often futile (the implementer can't
  // fix a "generated/prisma-postgres not found" build error that's a
  // stale-branch artifact, not a real defect in the diff) and burns the
  // bounded repair budget before ever surfacing the conflict. Check for a
  // real conflict FIRST — same handling as the no-CI DIRTY branch in the
  // watcher — before falling through to CI self-repair.
  if (await tryHandleConflict(c, 'CI failed and merge state is DIRTY')) return;

  // The previous repair bounce ended with no push — a re-run would be the same
  // no-op. Park honestly instead of burning the remaining repair budget.
  if (await isNoDiffSinceLastRepair(c)) {
    await markExhausted(
      c.taskId,
      c.prNumber,
      c.cwd,
      'ci repair produced no diff (head unchanged since last bounce)',
    );
    await notify({
      taskId: c.taskId,
      type: 'auto_merge_ci_repair_no_diff',
      title: '自動マージ保留（差分なしで終了）',
      message: `PR #${c.prNumber} のCI自己修復は変更なしで終了しました — CI失敗はローカル再現不能の可能性があります。手動で確認してください。`,
    });
    log.info(
      { taskId: c.taskId, prNumber: c.prNumber },
      '[auto-merge] Parked — CI repair produced no diff (head unchanged since last bounce)',
    );
    return;
  }

  // Attribution before spending a repair: checks that are red on the base
  // branch's latest run are inherited, not this PR's. All inherited → hold;
  // a mix → repair only the PR's own failures so the implementer is not sent
  // after failures it cannot influence.
  const baseFailing = await readBaseFailingJobs(c.cwd, c.baseBranch);
  const { inherited, own } = splitInheritedFailures(failedChecks, baseFailing);
  if (failedChecks.length > 0 && own.length === 0) {
    await holdForInheritedFailures(c, inherited);
    return;
  }
  const repairTargets = own.length > 0 ? own : failedChecks;

  // CI failed — try to self-repair: bounce the task back to the implementer
  // with the failing checks as feedback so it fixes them, pushes to the same
  // PR branch, and CI re-runs. The watcher merges once CI goes green. Only
  // park the PR for review once the bounded repair budget is exhausted.
  const repair = await attemptCiRepair(c.taskId, repairTargets, '', {
    cwd: c.cwd,
    prNumber: c.prNumber,
  });
  if (repair.bounced) {
    await notify({
      taskId: c.taskId,
      type: 'auto_merge_ci_repair',
      title: 'CI失敗を自動修正中',
      message: `PR #${c.prNumber} のCI失敗（${repairTargets.join(', ') || '不明'}）を検出。実装を修正して再検証します（${repair.attempt}回目）。`,
    });
    log.info(
      { taskId: c.taskId, prNumber: c.prNumber, attempt: repair.attempt },
      '[auto-merge] CI failed — bounced for self-repair',
    );
  } else {
    // Park as exhausted (terminal until the PR head changes). A windowed
    // `auto_merge_blocked` mark here re-ran attemptCiRepair every retry
    // window forever — 48 "repairs exhausted" warnings per day and a
    // re-notification every cooldown (observed: task 322 / PR #260).
    await markExhausted(c.taskId, c.prNumber, c.cwd, 'ci failed (repairs exhausted)');
    await notify({
      taskId: c.taskId,
      type: 'auto_merge_ci_failed',
      title: '自動マージ保留（CI失敗・修復上限）',
      message: `PR #${c.prNumber} のCIが自動修正の上限まで失敗したため、自動マージせずレビュー待ちにしました。修正をpushすると自動マージを再開します。`,
    });
    log.info(
      { taskId: c.taskId, prNumber: c.prNumber },
      '[auto-merge] Parked — CI failed, repairs exhausted',
    );
  }
}
