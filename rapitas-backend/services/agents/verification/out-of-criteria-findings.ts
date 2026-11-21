/**
 * out-of-criteria-findings
 *
 * Moves an evidenced major finding that no acceptance criterion covers out of
 * the review verdict and into the concern backlog, which turns it into its own
 * task. Not responsible for judging findings (review-findings.ts) or for the
 * panel vote (adversarial-diff-review-verdict.ts).
 *
 * NOTE: trendline task 1519 (2026-11-21) was bounced three times by real but
 * out-of-scope findings about several dev-all instances racing on one PID
 * file, a case none of its criteria named, and blocked as non-converging.
 * Each repair answered one race and the next review found another. A blocker
 * still fails the review wherever it lies: data loss or a security hole is
 * never deferred to a later task.
 */
import { createHash } from 'node:crypto';
import { createLogger } from '../../../config/logger';
import type { DiffReviewResult } from './adversarial-diff-review-verdict';
import { formatFindingReason, type ReviewFinding } from './review-findings';

const log = createLogger('verification:out-of-criteria-findings');

/** True when the finding names a criterion that exists (受入基準1..count). */
function namesCriterion(f: ReviewFinding, criteriaCount: number): boolean {
  // The prompt also allows the criterion as a summary prefix (「受入基準2: …」).
  const m = f.criterion?.match(/^受入基準(\d+)$/) ?? f.summary.match(/^受入基準\s*(\d+)\s*[:：]/);
  if (!m) return false;
  const n = Number(m[1]);
  return n >= 1 && n <= criteriaCount;
}

/**
 * Take the out-of-criteria major findings out of a failing review.
 *
 * @param result - Panel result after the other filters / 他の後処理を済ませた判定
 * @param criteriaCount - Number of acceptance criteria on the task / 完了条件の数
 * @returns The adjusted result and the findings moved out / 調整後の判定と外した指摘
 */
export function splitOutOfCriteria(
  result: DiffReviewResult,
  criteriaCount: number,
): { result: DiffReviewResult; outOfCriteria: ReviewFinding[] } {
  // A task without criteria has nothing to be "outside of".
  if (result.verdict !== 'fail' || criteriaCount <= 0) return { result, outOfCriteria: [] };
  const outOfCriteria = (result.findings ?? []).filter(
    (f) => f.gating && f.severity === 'major' && !namesCriterion(f, criteriaCount),
  );
  if (outOfCriteria.length === 0) return { result, outOfCriteria };
  const moved = new Set(outOfCriteria.map(formatFindingReason));
  const reasons = result.reasons.filter((r) => !moved.has(r));
  const findings = (result.findings ?? []).map((f) =>
    outOfCriteria.includes(f) ? { ...f, gating: false } : f,
  );
  if (reasons.length === 0) {
    return {
      result: { ...result, verdict: 'pass', severity: 0, reasons, findings },
      outOfCriteria,
    };
  }
  return { result: { ...result, reasons, findings }, outOfCriteria };
}

/**
 * File each out-of-criteria finding as a concern on the task's theme, so the
 * backlog promoter turns it into a task. Best-effort: a failure is logged and
 * never changes the review.
 *
 * @param findings - Findings moved out of the verdict / 判定から外した指摘
 * @param ctx.taskId - Task under review / レビュー対象のタスク
 * @param ctx.themeId - Its theme, so the new task joins the same auto-run / テーマ
 */
export async function fileOutOfCriteriaFindings(
  findings: ReviewFinding[],
  ctx: { taskId: number; themeId: number | null },
): Promise<void> {
  if (findings.length === 0) return;
  try {
    const { submitConcern } = await import('../../memory/concern-backlog-service');
    for (const f of findings) {
      const digest = createHash('sha1').update(f.summary).digest('hex').slice(0, 12);
      await submitConcern({
        title: f.summary.slice(0, 120),
        detail:
          `タスク #${ctx.taskId} の独立レビューで見つかったが、そのタスクの完了条件の外にあるため、` +
          `合否には使わず別タスクとして起票した指摘。\n\n${formatFindingReason(f)}` +
          (f.repro ? `\n\n再現: ${f.repro}` : ''),
        type: 'bug',
        severity: 'high',
        ...(f.evidence ? { location: f.evidence.slice(0, 200) } : {}),
        originTaskId: ctx.taskId,
        ...(ctx.themeId != null ? { themeId: ctx.themeId } : {}),
        source: 'adversarial_review_out_of_criteria',
        dedupKey: `out-of-criteria:${ctx.taskId}:${digest}`,
      });
    }
    log.info(
      { taskId: ctx.taskId, count: findings.length },
      '[out-of-criteria] Out-of-scope review findings filed as concerns',
    );
  } catch (err) {
    log.warn({ err, taskId: ctx.taskId }, '[out-of-criteria] Could not file the findings');
  }
}
