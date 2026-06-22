/**
 * Auto-Merge Watcher
 *
 * Merges the PR of a completed task that opted into auto-merge
 * (AgentExecutionConfig.autoMergePR) — but ONLY after the PR's GitHub CI checks
 * are green ("検証通過＋動作も問題なし"). A CI-red PR is left open for review and
 * the task is flagged. NOT responsible for creating the PR (that is the
 * workflow auto-commit path) — only for the CI-gated merge step.
 *
 * Eligibility is derived from existing data (completed task + autoMergePR policy
 * + an open linked PR, minus a transition marker), so no schema change is needed.
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { resolveAutomationPolicy } from './automation-policy';
import { mergePullRequest } from '../agents/orchestrator/git-operations/branch-pr-ops';
import { recordTransition } from './transition-recorder';
import { attemptCiRepair } from './ci-self-repair';
import { fileConflictResolutionTask } from '../github/conflict-task';

const execAsync = promisify(exec);
const log = createLogger('workflow:auto-merge-watcher');

/** Poll cadence. CI takes minutes, so a 60s tick is plenty. */
const POLL_INTERVAL_MS = 60_000;
/** Give up waiting for CI after this long and flag the PR for review. */
const PENDING_TIMEOUT_MS = 90 * 60 * 1000; // 90 min
/**
 * Causes that mark a task TERMINALLY resolved — the work landed, never retry.
 * Note `auto_merge_blocked` is intentionally NOT here: a block is often transient
 * (a conflict from a wrong base, a flaky merge) and the PR can become mergeable
 * later. Permanently skipping on it left retargeted-but-blocked PRs open forever.
 */
const TERMINAL_CAUSES = ['auto_merged', 'pr_ci_completed'];
/**
 * Retry a previously `auto_merge_blocked` PR until it merges or this many blocks
 * accumulate, then give up for good (avoids re-notifying every tick on a PR that
 * genuinely cannot merge). Each failed merge records one more block.
 */
const MAX_BLOCK_RETRIES = 3;
/**
 * File a conflict-resolution task at most this many times for one PR before
 * giving up and blocking for manual review. Each re-file happens only AFTER the
 * prior conflict task finished without making the PR mergeable, so this bounds a
 * genuinely-unresolvable conflict instead of re-filing forever.
 */
const MAX_CONFLICT_RETRIES = 2;

/**
 * Staged completion (RAPITAS_STAGED_COMPLETION): when ON, a task that landed via
 * a PR is NOT completed at PR creation — `pr` mode completes when the PR's CI is
 * green (no merge), `merge` mode completes when the PR is merged. The watcher
 * therefore also picks up not-yet-completed tasks (verify_done) and marks them
 * done at the right point. When OFF, only already-`done` autoMergePR tasks merge
 * (legacy behaviour), so nothing regresses.
 */
function stagedCompletionEnabled(): boolean {
  return (
    process.env.RAPITAS_STAGED_COMPLETION === 'true' ||
    process.env.RAPITAS_STAGED_COMPLETION === '1'
  );
}

/**
 * Checks that GATE the merge. A PR merges only when every present blocking check
 * passes; advisory checks (bundle size, performance, CodeQL, previews) are
 * ignored. Overridable via RAPITAS_AUTOMERGE_CHECKS (comma-separated names).
 */
const DEFAULT_BLOCKING_CHECKS = [
  'Test Backend',
  'Lint Code',
  'Check Frontend',
  'Test SQLite Compatible Suite',
  'Check Rust Code',
  'Lint Markdown files',
  'Lint GitHub Actions workflows',
  'Secret scanning',
  // Build gates: never auto-merge code that doesn't build. (macOS/Windows build
  // matrices are intentionally NOT blocking — they are slower/flakier; the Linux
  // build + Quick Build Check are the representative gate. Override via
  // RAPITAS_AUTOMERGE_CHECKS if your matrix differs.)
  'Quick Build Check',
  'Build (ubuntu-latest)',
];

function blockingChecks(): Set<string> {
  const raw = process.env.RAPITAS_AUTOMERGE_CHECKS;
  const names = raw
    ? raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : DEFAULT_BLOCKING_CHECKS;
  return new Set(names);
}

function ghPath(): string {
  return process.platform === 'win32' ? '"C:\\Program Files\\GitHub CLI\\gh.exe"' : 'gh';
}

export type CheckState = 'pass' | 'fail' | 'pending' | 'unknown';

/** One CI check as returned by `gh pr checks --json name,bucket`. */
export interface PrCheck {
  name: string;
  bucket: string;
}

/**
 * Decide the aggregate state of the blocking checks. Pure — the testable core.
 *
 * @param checks - All checks reported for the PR. / PRの全チェック
 * @param blocking - Names that gate the merge. / マージをゲートするチェック名
 * @returns 'pass' when every present blocking check passed, 'fail' if any
 *   failed/cancelled, 'pending' if any is still running, 'unknown' if none of
 *   the blocking checks have reported yet. / 集約状態
 */
export function evaluateAutoMergeChecks(checks: PrCheck[], blocking: Set<string>): CheckState {
  const relevant = checks.filter((c) => blocking.has(c.name));
  if (relevant.length === 0) return 'unknown';
  if (relevant.some((c) => c.bucket === 'fail' || c.bucket === 'cancel')) return 'fail';
  if (relevant.some((c) => c.bucket === 'pending')) return 'pending';
  // Everything present is pass/skipping.
  return 'pass';
}

/** Read the PR's checks via gh. Tolerates gh's non-zero exit on red/pending. */
async function readPrChecks(cwd: string, prNumber: number): Promise<PrCheck[] | null> {
  try {
    const { stdout } = await execAsync(`${ghPath()} pr checks ${prNumber} --json name,bucket`, {
      cwd,
      encoding: 'utf8',
    });
    return JSON.parse(stdout) as PrCheck[];
  } catch (err) {
    // gh exits non-zero when checks are failing/pending but still prints JSON.
    const stdout = (err as { stdout?: string }).stdout;
    if (stdout) {
      try {
        return JSON.parse(stdout) as PrCheck[];
      } catch {
        /* fall through */
      }
    }
    // A PR whose branch has no CI configured exits non-zero with this exact
    // stderr and empty stdout. That is NOT an error — treat it as "no checks
    // reported yet" (→ 'unknown' → the pending/timeout path) instead of logging a
    // WARN every 60s for every checkless PR (observed: #142/195/197-206 spamming).
    const stderr = (err as { stderr?: string }).stderr ?? '';
    if (/no checks reported/i.test(stderr)) {
      log.debug({ prNumber }, '[auto-merge] PR has no checks reported (no CI on branch)');
      return [];
    }
    log.warn({ err, prNumber }, '[auto-merge] Failed to read PR checks');
    return null;
  }
}

/**
 * Read GitHub's authoritative merge state (mergeStateStatus) for a PR. Used as a
 * fallback when no blocking CI checks are present: a branch with NO CI configured
 * would otherwise sit at 'unknown' forever and time out UNMERGED, even though
 * GitHub considers the PR CLEAN/mergeable. Returns null on a transient gh error.
 *
 * @param cwd - Repo working directory / リポジトリ作業ディレクトリ
 * @param prNumber - PR number / PR番号
 * @returns mergeStateStatus ('CLEAN' | 'BLOCKED' | 'BEHIND' | 'DIRTY' | 'UNKNOWN' …) or null
 */
async function readMergeState(cwd: string, prNumber: number): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`${ghPath()} pr view ${prNumber} --json mergeStateStatus`, {
      cwd,
      encoding: 'utf8',
    });
    const parsed = JSON.parse(stdout) as { mergeStateStatus?: string };
    return parsed.mergeStateStatus ?? null;
  } catch (err) {
    log.warn({ err, prNumber }, '[auto-merge] Failed to read PR merge state');
    return null;
  }
}

interface NotifyParams {
  taskId: number;
  type: string;
  title: string;
  message: string;
}
async function notify(p: NotifyParams): Promise<void> {
  await prisma.notification
    .create({
      data: {
        type: p.type,
        title: p.title,
        message: p.message,
        link: `/tasks/${p.taskId}`,
        metadata: JSON.stringify({ taskId: p.taskId }),
      },
    })
    .catch(() => {});
}

/** A task whose PR is waiting on CI before auto-merge / CI-green completion. */
interface Candidate {
  taskId: number;
  taskTitle: string;
  prNumber: number;
  baseBranch: string;
  cwd: string;
  threshold: number;
  completedAt: Date | null;
  /** `merge`: merge on CI green, then complete. `pr`: complete on CI green (no merge). */
  mode: 'merge' | 'pr';
}

/**
 * Mark a task row done/completed (idempotent). Used when the watcher is the one
 * that reaches a task's completion point under staged completion.
 */
async function completeTaskRow(taskId: number): Promise<void> {
  await prisma.task
    .update({
      where: { id: taskId },
      data: { status: 'done', workflowStatus: 'completed', completedAt: new Date() },
    })
    .catch((err) => log.warn({ err, taskId }, '[auto-merge] completeTaskRow failed'));
}

/**
 * Find tasks whose linked PR is open, that opted into auto-merge, and that have
 * not already been merged/blocked. Bounded by the (small) set of open linked PRs.
 */
async function findCandidates(): Promise<Candidate[]> {
  // Two link sources. pr-link.ts sets BOTH GitHubPullRequest.linkedTaskId AND the
  // Task.githubPrId fallback, but rows pulled in by a webhook sync (or created
  // when integration resolution failed at link time) have a NULL linkedTaskId
  // while task.githubPrId is still set. The watcher used to query only
  // linkedTaskId, so those PRs were invisible and never auto-merged (observed:
  // #211-#215, all CLEAN/MERGEABLE, linkedTaskId=null but task.githubPrId set).
  const links = new Map<number, { prNumber: number; baseBranch: string | null }>();

  const openPrs = await prisma.gitHubPullRequest.findMany({
    where: { state: 'open', linkedTaskId: { not: null } },
    select: { prNumber: true, baseBranch: true, linkedTaskId: true },
  });
  for (const pr of openPrs) {
    if (pr.linkedTaskId != null && !links.has(pr.linkedTaskId)) {
      links.set(pr.linkedTaskId, { prNumber: pr.prNumber, baseBranch: pr.baseBranch });
    }
  }

  // Fallback: tasks carrying a githubPrId whose PR row is not linkedTaskId-linked.
  // Only adopt one when an OPEN local PR row for that number exists (so we never
  // act on a closed/merged or unknown PR).
  const prTasks = await prisma.task
    .findMany({ where: { githubPrId: { not: null } }, select: { id: true, githubPrId: true } })
    .catch(() => [] as { id: number; githubPrId: number | null }[]);
  for (const t of prTasks) {
    if (t.githubPrId == null || links.has(t.id)) continue;
    const row = await prisma.gitHubPullRequest
      .findFirst({ where: { prNumber: t.githubPrId, state: 'open' }, select: { baseBranch: true } })
      .catch(() => null);
    if (!row) continue;
    links.set(t.id, { prNumber: t.githubPrId, baseBranch: row.baseBranch });
  }

  const out: Candidate[] = [];
  for (const [taskId, link] of links) {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        status: true,
        workflowStatus: true,
        completedAt: true,
        workingDirectory: true,
        theme: { select: { workingDirectory: true } },
      },
    });
    if (!task) continue;

    const staged = stagedCompletionEnabled();
    const isCompleted = task.status === 'done' || task.status === 'completed';
    // Under staged completion the task is still in-progress at verify_done while
    // its PR's CI runs; pick those up so the watcher can complete them.
    const isAwaitingCi = staged && task.workflowStatus === 'verify_done' && !isCompleted;
    if (!isCompleted && !isAwaitingCi) continue;

    const policy = await resolveAutomationPolicy(prisma, taskId).catch(() => null);
    // merge mode in any era; pr mode (complete on CI green, no merge) only when
    // staged completion is enabled — otherwise pr-mode tasks already completed at
    // verify and the watcher must not touch them.
    const mode: 'merge' | 'pr' | null = policy?.autoMergePR
      ? 'merge'
      : staged && policy?.autoCreatePR
        ? 'pr'
        : null;
    if (!mode) continue;

    // Terminally resolved (merged / CI-completed) — skip for good.
    const terminal = await prisma.workflowTransition
      .count({ where: { taskId, cause: { in: TERMINAL_CAUSES } } })
      .catch(() => 0);
    if (terminal > 0) continue;

    // Previously blocked: retry (the block may have been transient — e.g. a
    // wrong-base conflict since retargeted) until the block budget is spent.
    const blocked = await prisma.workflowTransition
      .count({ where: { taskId, cause: 'auto_merge_blocked' } })
      .catch(() => 0);
    if (blocked >= MAX_BLOCK_RETRIES) continue;

    const cwd = task.workingDirectory || task.theme?.workingDirectory;
    if (!cwd) continue;

    const cfg = await prisma.agentExecutionConfig
      .findUnique({ where: { taskId }, select: { mergeCommitThreshold: true } })
      .catch(() => null);

    out.push({
      taskId,
      taskTitle: task.title,
      prNumber: link.prNumber,
      baseBranch: link.baseBranch || 'develop',
      cwd,
      threshold: cfg?.mergeCommitThreshold ?? 5,
      completedAt: task.completedAt,
      mode,
    });
  }
  return out;
}

/** Record a terminal auto-merge outcome so the candidate is not reprocessed. */
async function mark(taskId: number, cause: string, reason: string): Promise<void> {
  await recordTransition({
    taskId,
    fromStatus: 'completed',
    toStatus: 'completed',
    actor: 'system',
    cause,
    phase: 'verify',
    metadata: { reason },
  }).catch(() => {});
}

/**
 * Auto-Merge Watcher singleton. Started at boot; ticks on an interval.
 */
export class AutoMergeWatcher {
  private static instance: AutoMergeWatcher;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  static getInstance(): AutoMergeWatcher {
    if (!AutoMergeWatcher.instance) AutoMergeWatcher.instance = new AutoMergeWatcher();
    return AutoMergeWatcher.instance;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
    log.info('[auto-merge] Watcher started');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass: evaluate every candidate's CI and merge / block / wait. */
  async tick(): Promise<void> {
    if (this.ticking) return; // never overlap ticks
    this.ticking = true;
    try {
      const candidates = await findCandidates();
      const blocking = blockingChecks();
      for (const c of candidates) {
        try {
          await this.process(c, blocking);
        } catch (err) {
          log.warn({ err, taskId: c.taskId }, '[auto-merge] Candidate failed');
        }
      }
    } catch (err) {
      log.error({ err }, '[auto-merge] Tick error');
    } finally {
      this.ticking = false;
    }
  }

  /**
   * When a CI-green PR fails to merge because of a real CONFLICT (GitHub
   * mergeStateStatus DIRTY), automatically file the "PR #N の競合を解消" agent task
   * so auto-run resolves it on the PR branch — then a later tick re-merges the now
   * CLEAN PR with no human step. Deduped (one active task per PR) and bounded
   * (MAX_CONFLICT_RETRIES re-files before giving up to manual review).
   *
   * @param c - The auto-merge candidate. / 自動マージ候補
   * @param mergeError - The merge failure message (for the blocked note). / マージ失敗理由
   * @returns true when the conflict path handled this (caller returns). / 競合処理したか
   */
  private async handleMergeConflict(c: Candidate, mergeError?: string): Promise<boolean> {
    const ghState = await readMergeState(c.cwd, c.prNumber);
    // DIRTY is GitHub's "the PR has merge conflicts" state. Any other failure
    // (e.g. branch protection, permissions) is NOT a conflict — let the caller
    // block it for manual review.
    if (ghState !== 'DIRTY') return false;

    const conflictAttempts = await prisma.workflowTransition
      .count({ where: { taskId: c.taskId, cause: 'auto_merge_conflict_filed' } })
      .catch(() => 0);
    if (conflictAttempts >= MAX_CONFLICT_RETRIES) {
      await mark(
        c.taskId,
        'auto_merge_blocked',
        `conflict unresolved after ${conflictAttempts} attempts: ${mergeError ?? ''}`,
      );
      await notify({
        taskId: c.taskId,
        type: 'auto_merge_conflict_unresolved',
        title: '自動マージ保留（競合未解消）',
        message: `PR #${c.prNumber} の競合が自動解消の上限まで解消できませんでした。手動で確認してください。`,
      });
      return true;
    }

    // Need the PR's head branch + title to author the resolution instructions.
    const prRow = await prisma.gitHubPullRequest
      .findFirst({
        where: { prNumber: c.prNumber },
        select: { title: true, headBranch: true, baseBranch: true },
      })
      .catch(() => null);
    if (!prRow?.headBranch) {
      // Can't author instructions without the head branch — fall back to block.
      return false;
    }

    const themeRow = await prisma.task
      .findUnique({ where: { id: c.taskId }, select: { themeId: true } })
      .catch(() => null);

    const filed = await fileConflictResolutionTask(
      {
        prNumber: c.prNumber,
        title: prRow.title || c.taskTitle,
        baseBranch: prRow.baseBranch || c.baseBranch,
        headBranch: prRow.headBranch,
      },
      c.cwd,
      themeRow?.themeId ?? null,
    );

    if (filed.created) {
      // Non-terminal mark: bounds re-files AND lets the next tick re-merge.
      await mark(c.taskId, 'auto_merge_conflict_filed', `filed conflict task #${filed.taskId}`);
      await notify({
        taskId: c.taskId,
        type: 'auto_merge_conflict_filed',
        title: '競合を自動解消中',
        message: `PR #${c.prNumber} にマージ競合を検出。解消タスク#${filed.taskId}を自動起票しました。解消後に自動マージします。`,
      });
      log.info(
        { taskId: c.taskId, prNumber: c.prNumber, conflictTaskId: filed.taskId },
        '[auto-merge] Conflict detected — filed resolution task, will re-merge when CLEAN',
      );
      return true;
    }
    if (filed.taskId) {
      // An active conflict task is still resolving — wait, re-merge next tick.
      return true;
    }
    // Creation failed — let the caller block it.
    return false;
  }

  private async process(c: Candidate, blocking: Set<string>): Promise<void> {
    const checks = await readPrChecks(c.cwd, c.prNumber);
    if (checks === null) return; // transient gh error — retry next tick

    let state = evaluateAutoMergeChecks(checks, blocking);

    // No blocking CI checks reported (e.g. the branch has no CI configured, or only
    // advisory checks ran). 'unknown' would wait for CI that never arrives and then
    // time out → auto_merge_blocked, so a CLEAN, mergeable PR would never merge.
    // Defer to GitHub's authoritative merge state: only when GitHub itself reports
    // CLEAN (nothing blocking) do we treat it as pass. BLOCKED/BEHIND/DIRTY/UNKNOWN
    // keep waiting, so this never merges past a real pending/failed required check.
    if (state === 'unknown') {
      const ghState = await readMergeState(c.cwd, c.prNumber);
      if (ghState === 'CLEAN') {
        state = 'pass';
        log.info(
          { taskId: c.taskId, prNumber: c.prNumber },
          '[auto-merge] No blocking CI checks; GitHub merge state CLEAN — treating as pass',
        );
      }
    }

    if (state === 'pass') {
      // PR mode: CI is green and we DO NOT merge — completion is reaching green.
      if (c.mode === 'pr') {
        await completeTaskRow(c.taskId);
        await mark(c.taskId, 'pr_ci_completed', `PR #${c.prNumber} CI green`);
        await notify({
          taskId: c.taskId,
          type: 'pr_ci_completed',
          title: 'CI通過で完了',
          message: `PR #${c.prNumber} のCIが通過したためタスクを完了にしました（マージは手動）。`,
        });
        log.info(
          { taskId: c.taskId, prNumber: c.prNumber },
          '[auto-merge] PR CI green — task completed (no merge, pr mode)',
        );
        return;
      }

      const res = await mergePullRequest(c.cwd, c.prNumber, c.threshold, c.baseBranch);
      if (res.success) {
        // Under staged completion the task is still in-progress at verify_done;
        // completing on merge is the merge-mode completion point. Idempotent for
        // the legacy path where the task was already done.
        await completeTaskRow(c.taskId);
        // Sync the LOCAL PR mirror to merged. The watcher merged on GitHub, but
        // nothing else updates the local GitHubPullRequest row (there is no webhook
        // in dev), so it kept showing 'open' even though the PR was merged — the
        // "PR won't merge" the user saw was actually a stale local state.
        await prisma.gitHubPullRequest
          .updateMany({
            where: { prNumber: c.prNumber, state: 'open' },
            data: { state: 'merged', updatedAt: new Date() },
          })
          .catch((err) =>
            log.warn(
              { err, prNumber: c.prNumber },
              '[auto-merge] Failed to sync local PR row to merged',
            ),
          );
        await mark(c.taskId, 'auto_merged', `strategy=${res.mergeStrategy}`);
        await notify({
          taskId: c.taskId,
          type: 'auto_merge_success',
          title: '自動マージ完了',
          message: `PR #${c.prNumber} をCI通過後に自動マージしました（${res.mergeStrategy}）`,
        });
        log.info({ taskId: c.taskId, prNumber: c.prNumber }, '[auto-merge] Merged after CI pass');
      } else if (res.retriable) {
        // Head branch was behind base; mergePullRequest updated it. Do NOT mark
        // terminal — the branch update triggers a fresh CI run; the next tick
        // re-evaluates and merges once checks are green and the branch is current.
        log.info(
          { taskId: c.taskId, prNumber: c.prNumber, reason: res.error },
          '[auto-merge] Head behind base — updated branch, will retry next tick',
        );
      } else if (await this.handleMergeConflict(c, res.error)) {
        // A real merge conflict — handled by auto-filing a resolution task (or
        // waiting on an in-flight one / giving up after the bound). Either way the
        // candidate is NOT marked terminal here so a later tick re-merges once the
        // conflict task pushes its fix and the PR goes CLEAN.
        return;
      } else {
        await mark(c.taskId, 'auto_merge_blocked', `merge failed: ${res.error}`);
        await notify({
          taskId: c.taskId,
          type: 'auto_merge_failed',
          title: '自動マージ失敗',
          message: `PR #${c.prNumber} はCI通過後のマージに失敗しました。手動で確認してください: ${res.error ?? ''}`,
        });
      }
      return;
    }

    if (state === 'fail') {
      // CI failed — try to self-repair: bounce the task back to the implementer
      // with the failing checks as feedback so it fixes them, pushes to the same
      // PR branch, and CI re-runs. The watcher merges once CI goes green. Only
      // flag the PR for review once the bounded repair budget is exhausted.
      const failedChecks = checks
        .filter((ch) => blocking.has(ch.name) && (ch.bucket === 'fail' || ch.bucket === 'cancel'))
        .map((ch) => ch.name);
      const repair = await attemptCiRepair(c.taskId, failedChecks);
      if (repair.bounced) {
        await notify({
          taskId: c.taskId,
          type: 'auto_merge_ci_repair',
          title: 'CI失敗を自動修正中',
          message: `PR #${c.prNumber} のCI失敗（${failedChecks.join(', ') || '不明'}）を検出。実装を修正して再検証します（${repair.attempt}回目）。`,
        });
        log.info(
          { taskId: c.taskId, prNumber: c.prNumber, attempt: repair.attempt },
          '[auto-merge] CI failed — bounced for self-repair',
        );
      } else {
        await mark(c.taskId, 'auto_merge_blocked', 'ci failed (repairs exhausted)');
        await notify({
          taskId: c.taskId,
          type: 'auto_merge_ci_failed',
          title: '自動マージ保留（CI失敗・修復上限）',
          message: `PR #${c.prNumber} のCIが自動修正の上限まで失敗したため、自動マージせずレビュー待ちにしました。`,
        });
        log.info(
          { taskId: c.taskId, prNumber: c.prNumber },
          '[auto-merge] Held — CI failed, repairs exhausted',
        );
      }
      return;
    }

    // pending / unknown — wait, unless we have waited too long.
    const since = c.completedAt?.getTime() ?? Date.now();
    if (Date.now() - since > PENDING_TIMEOUT_MS) {
      await mark(c.taskId, 'auto_merge_blocked', 'ci timeout');
      await notify({
        taskId: c.taskId,
        type: 'auto_merge_timeout',
        title: '自動マージ保留（CIタイムアウト）',
        message: `PR #${c.prNumber} のCIが時間内に完了しなかったため自動マージを保留しました。`,
      });
    }
  }
}
