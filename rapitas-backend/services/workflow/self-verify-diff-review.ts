/**
 * Self-Verify Diff Review
 *
 * Runs the adversarial diff review (the same prompt and jury as the gate after
 * verify.md is saved) inside the implementer's self-verification job, and looks
 * up a passing self-verify review that the post-save gate may reuse for the
 * exact same diff. Not responsible for the review logic itself
 * (services/agents/verification/adversarial-diff-review.ts) or for applying a
 * verdict to the workflow status.
 *
 * Why: a jury FAIL after verify.md costs a whole verifier run per round trip.
 * Reviewing during self-verification lets the implementer fix the findings
 * before the verifier runs at all.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import { runGitCommand } from '../github/git-exec';
import type {
  DiffReviewResult,
  PanelVerdict,
  ReviewFinding,
} from '../agents/verification/adversarial-diff-review-verdict';

const log = createLogger('services:workflow:self-verify-diff-review');

/** Why the self-verify review did not call the jury. */
export type SelfVerifySkipReason = 'empty_diff' | 'gate_failed' | 'disabled';

/** The diff-review part of a self-verification result. */
export interface SelfVerifyDiffReview {
  status: 'reviewed' | 'skipped';
  skippedReason?: SelfVerifySkipReason;
  verdict?: PanelVerdict;
  severity?: number;
  reasons?: string[];
  findings?: ReviewFinding[];
  /** Fingerprint of the diff the jury reviewed (reuse key). */
  diffFingerprint?: string | null;
  /** HEAD of the worktree when the review ran (reuse key). */
  headSha?: string | null;
  /** Completion-criteria revision the review judged against (reuse key). */
  criteriaRevision?: string | null;
}

/** The three values a reusable review must match. */
export interface SelfVerifyReuseKey {
  diffFingerprint: string | null;
  headSha: string | null;
  criteriaRevision: string | null;
}

async function readHeadSha(worktreePath: string): Promise<string | null> {
  try {
    const out = await runGitCommand(['rev-parse', 'HEAD'], worktreePath, {
      timeoutMs: 5_000,
      skipLog: true,
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Read the current reuse key of a task's worktree. Never throws; an unreadable
 * part is null, and a null part never matches.
 *
 * @param taskId - Task id / タスクID
 * @param worktreePath - The task's worktree / worktree のパス
 * @returns Diff fingerprint, HEAD and criteria revision / 差分指紋・HEAD・受入条件の版
 */
export async function readSelfVerifyReuseKey(
  taskId: number,
  worktreePath: string,
): Promise<SelfVerifyReuseKey> {
  const [{ currentDiffFingerprint }, { readCriteriaRevision }] = await Promise.all([
    import('../agents/verification/review-diff-fingerprint'),
    import('../task/task-criteria-revision'),
  ]);
  const [diffFingerprint, headSha, criteriaRevision] = await Promise.all([
    currentDiffFingerprint(taskId, worktreePath).catch(() => null),
    readHeadSha(worktreePath),
    readCriteriaRevision(prisma, taskId).catch(() => null),
  ]);
  return { diffFingerprint, headSha, criteriaRevision };
}

/**
 * Run the adversarial diff review for a self-verification job. The jury is
 * called only when the gate passed, the review is enabled and there is a diff.
 * Never throws: a review that breaks is recorded as an `unknown` verdict.
 *
 * @param p.taskId - Task under review / 対象タスク
 * @param p.worktreePath - The task's worktree / worktree のパス
 * @param p.gateOk - Whether lint/type/test gates passed / ゲートが合格したか
 * @returns The review part of the self-verification result / 自己検証結果のレビュー部分
 */
export async function runSelfVerifyDiffReview(p: {
  taskId: number;
  worktreePath: string;
  gateOk: boolean;
}): Promise<SelfVerifyDiffReview> {
  if (!p.gateOk) return { status: 'skipped', skippedReason: 'gate_failed' };
  try {
    const { reviewDiffAdversarially, isAdversarialReviewEnabled } =
      await import('../agents/verification/adversarial-diff-review');
    if (!isAdversarialReviewEnabled()) return { status: 'skipped', skippedReason: 'disabled' };
    const key = await readSelfVerifyReuseKey(p.taskId, p.worktreePath);
    // Checked here, not left to the judge: an empty diff must not reach the
    // jury call at all (費用を増やさない — task 1538 受入条件3).
    if (key.diffFingerprint === null) return { status: 'skipped', skippedReason: 'empty_diff' };
    const review = await reviewDiffAdversarially({
      taskId: p.taskId,
      worktreePath: p.worktreePath,
    });
    const { capFindingsForStorage } = await import('../agents/verification/review-findings');
    return {
      status: 'reviewed',
      verdict: review.verdict,
      severity: review.severity,
      reasons: review.reasons,
      findings: capFindingsForStorage(review.findings),
      // What the jury actually saw wins over the pre-review read.
      diffFingerprint: review.diffFingerprint ?? key.diffFingerprint,
      headSha: key.headSha,
      criteriaRevision: key.criteriaRevision,
    };
  } catch (err) {
    log.warn({ err, taskId: p.taskId }, '[self-verify-review] Review errored — recorded as unknown');
    return { status: 'reviewed', verdict: 'unknown', severity: 0, reasons: [] };
  }
}

/** A self-verify review the post-save gate may use instead of calling the jury. */
export interface ReusableSelfVerifyReview {
  review: DiffReviewResult;
  runId: string;
}

/**
 * Find a passing self-verify review for exactly the current diff. Only the
 * newest self-verification job counts, and it must have passed its gates and
 * the jury (`pass` — `unknown`/`hold` are never reused), with the diff
 * fingerprint, HEAD and criteria revision all equal to the current ones.
 * Never throws; anything unreadable means "not reusable".
 *
 * @param taskId - Task id / タスクID
 * @param worktreePath - The task's worktree / worktree のパス
 * @returns The reusable review and its job runId, or null / 再利用できるレビュー（無ければ null）
 */
export async function findReusableSelfVerifyReview(
  taskId: number,
  worktreePath: string,
): Promise<ReusableSelfVerifyReview | null> {
  try {
    const { getLatestJob } = await import('./verification-job-store');
    const job = await getLatestJob(taskId);
    const r = job?.diffReview;
    if (
      !job ||
      job.status !== 'completed' ||
      job.ok !== true ||
      job.unverifiable !== false ||
      r?.status !== 'reviewed' ||
      r.verdict !== 'pass' ||
      !r.diffFingerprint ||
      !r.headSha ||
      !r.criteriaRevision
    ) {
      return null;
    }
    const now = await readSelfVerifyReuseKey(taskId, worktreePath);
    if (
      now.diffFingerprint !== r.diffFingerprint ||
      now.headSha !== r.headSha ||
      now.criteriaRevision !== r.criteriaRevision
    ) {
      return null;
    }
    return {
      runId: job.runId,
      review: {
        verdict: 'pass',
        severity: r.severity ?? 0,
        reasons: r.reasons ?? [],
        findings: r.findings,
        judged: true,
        diffFingerprint: r.diffFingerprint,
      },
    };
  } catch (err) {
    log.warn({ err, taskId }, '[self-verify-review] Reuse lookup failed — not reusing');
    return null;
  }
}
