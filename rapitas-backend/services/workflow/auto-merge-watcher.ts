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

const execAsync = promisify(exec);
const log = createLogger('workflow:auto-merge-watcher');

/** Poll cadence. CI takes minutes, so a 60s tick is plenty. */
const POLL_INTERVAL_MS = 60_000;
/** Give up waiting for CI after this long and flag the PR for review. */
const PENDING_TIMEOUT_MS = 90 * 60 * 1000; // 90 min
/** Transition causes that mark a task's auto-merge as already resolved. */
const DONE_CAUSES = ['auto_merged', 'auto_merge_blocked'];

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
    log.warn({ err, prNumber }, '[auto-merge] Failed to read PR checks');
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

/** A task whose PR is waiting on CI before auto-merge. */
interface Candidate {
  taskId: number;
  taskTitle: string;
  prNumber: number;
  baseBranch: string;
  cwd: string;
  threshold: number;
  completedAt: Date | null;
}

/**
 * Find tasks whose linked PR is open, that opted into auto-merge, and that have
 * not already been merged/blocked. Bounded by the (small) set of open linked PRs.
 */
async function findCandidates(): Promise<Candidate[]> {
  const openPrs = await prisma.gitHubPullRequest.findMany({
    where: { state: 'open', linkedTaskId: { not: null } },
    select: { prNumber: true, baseBranch: true, linkedTaskId: true },
  });

  const out: Candidate[] = [];
  for (const pr of openPrs) {
    const taskId = pr.linkedTaskId;
    if (taskId == null) continue;

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        status: true,
        completedAt: true,
        workingDirectory: true,
        theme: { select: { workingDirectory: true } },
      },
    });
    if (!task || (task.status !== 'done' && task.status !== 'completed')) continue;

    const policy = await resolveAutomationPolicy(prisma, taskId).catch(() => null);
    if (!policy?.autoMergePR) continue;

    // Already merged or already given up — skip.
    const resolved = await prisma.workflowTransition
      .count({ where: { taskId, cause: { in: DONE_CAUSES } } })
      .catch(() => 0);
    if (resolved > 0) continue;

    const cwd = task.workingDirectory || task.theme?.workingDirectory;
    if (!cwd) continue;

    const cfg = await prisma.agentExecutionConfig
      .findUnique({ where: { taskId }, select: { mergeCommitThreshold: true } })
      .catch(() => null);

    out.push({
      taskId,
      taskTitle: task.title,
      prNumber: pr.prNumber,
      baseBranch: pr.baseBranch || 'develop',
      cwd,
      threshold: cfg?.mergeCommitThreshold ?? 5,
      completedAt: task.completedAt,
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

  private async process(c: Candidate, blocking: Set<string>): Promise<void> {
    const checks = await readPrChecks(c.cwd, c.prNumber);
    if (checks === null) return; // transient gh error — retry next tick

    const state = evaluateAutoMergeChecks(checks, blocking);

    if (state === 'pass') {
      const res = await mergePullRequest(c.cwd, c.prNumber, c.threshold, c.baseBranch);
      if (res.success) {
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
