import { parseAcceptanceCriteria } from './review-acceptance-criteria';
/**
 * Adversarial Diff Review — two-reviewer form
 *
 * INDEPENDENT adversarial judging of the agent's FINAL diff — distinct from the
 * implementer's self-reported verify.md (which can hallucinate success). Two
 * blind reviewer seats judge the actual change against plan.md + acceptance
 * criteria; agreement settles it, and only a disagreement brings in a
 * non-voting verifier seat that checks the disputed findings' grounds
 * (two-seat-review.ts). On FAIL the caller bounces the workflow back to the
 * implementer; on 'hold' it parks the task for a human (review-hold.ts).
 *
 * NOTE: This replaced the three-seat majority vote (owner decision 2026-11-10).
 *
 * Availability policy is RISK-GATED on EVIDENCE (jury-unavailable-risk.ts):
 * when no reviewer produced a verdict, or the review errored, low-risk work
 * proceeds ('unknown') but high-risk work is held for a human ('hold') — an
 * unavailable jury must not wave through dangerous changes, and must not
 * bounce work it never judged either. Read-only; runs no git/tools.
 *
 * Research basis (docs/research/autonomous-os-improvement-roadmap.md R1):
 * single LLM judges are near-chance on objective correctness (JudgeBench,
 * arXiv:2410.12784); small heterogeneous juries beat a single frontier judge at
 * a fraction of the cost (PoLL, arXiv:2404.18796); independent votes beat
 * debate/devil's-advocate protocols (arXiv:2508.17536). Per-juror verdicts are
 * recorded to the timeline so future weighting can calibrate each judge against
 * realized task outcomes (Weaver, arXiv:2506.18203).
 */
import { getDiff } from '../orchestrator/git-operations/core/diff-structured';
import { fingerprintDiff } from './review-diff-fingerprint';
import { buildJuryDiffText } from './jury-diff-text';
import { summarisePanel } from './juror-unknown-reason';
import { runTwoSeatJury } from './two-seat-jury-run';
import { readWorkflowFile } from '../../workflow/workflow-file-utils';
import { appendEvent } from '../../memory/timeline';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { resolvePreferredBaseBranch } from '../../task/task-resolver';
import { buildDiffReviewPrompt } from './adversarial-diff-review-prompt';
import { decideUnavailableJury, type UnavailableContext } from './jury-unavailable-outcome';
import type { DiffReviewResult } from './adversarial-diff-review-verdict';
const log = createLogger('verification:adversarial-diff-review');

// NOTE: Prompt text and verdict parsing/aggregation moved to sibling modules
// (file-size split); re-exported so existing importers keep working.
export { buildDiffReviewPrompt } from './adversarial-diff-review-prompt';
export {
  parseReviewVerdict,
  aggregateJuryVerdicts,
  isNonVerdictOnlyFail,
} from './adversarial-diff-review-verdict';
export type {
  ReviewVerdict,
  PanelVerdict,
  JurorVerdict,
  DiffReviewResult,
  ReviewFinding,
  FindingSeverity,
} from './adversarial-diff-review-verdict';

export { buildJuryDiffText, type JuryDiffFile } from './jury-diff-text';

/** Whether the adversarial review is enabled (default ON; set 0/false to skip). */
export function isAdversarialReviewEnabled(): boolean {
  const v = (process.env.RAPITAS_ADVERSARIAL_REVIEW || '').trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
}

// NOTE: Juror calls, their timeout and the per-provider timeout history moved
// to juror-call.ts (file-size split); re-exported so existing importers and
// tests keep working.
export {
  JUROR_TIMEOUT_STRIKES,
  JUROR_COOLOFF_MS,
  resetJurorHealth,
  jurorIsRested,
  recordJurorOutcome,
} from './juror-call';

/**
 * The measured verification and verify.md's claim for the jury prompt.
 * Only a measurement taken on THIS worktree and THIS diff is shown; an older
 * one is history, never counter-evidence against the current claim.
 * Never throws: a missing measurement just means the jury is told so.
 *
 * @param taskId - Task under review / 対象タスク
 * @param target - Worktree and diff fingerprint being reviewed / 審査対象の worktree と差分
 * @returns Rendered measurement and claim (null when absent), and whether a non-matching one was skipped / 実測と自己申告
 */
async function loadJuryMeasurementInputs(
  taskId: number,
  target: { worktreePath: string; diffFingerprint: string | null },
): Promise<{ measuredVerification: string | null; verifyClaim: string | null; stale: boolean }> {
  try {
    const { loadMeasurementForTarget, renderMeasurementForJury, extractVerifyClaim } =
      await import('./verification-measurement-record');
    const [m, verify] = await Promise.all([
      loadMeasurementForTarget(taskId, target),
      readWorkflowFile(taskId, 'verify').catch(() => null),
    ]);
    return {
      measuredVerification: m.current ? renderMeasurementForJury(m.current) : null,
      verifyClaim: extractVerifyClaim(verify),
      stale: m.stale,
    };
  } catch {
    return { measuredVerification: null, verifyClaim: null, stale: false };
  }
}

/**
 * Run the adversarial diff review for a task with the two-reviewer jury.
 *
 * Availability: 'unknown' when disabled or no diff. When no reviewer produced
 * a verdict, or the review itself errored, the evidence-based risk decides
 * (decideUnavailableJury): low risk → 'unknown' (proceed, recorded), high
 * risk → 'hold' (a human decides; never a bounce for work nobody judged).
 *
 * @param params.taskId - Task under review. / 対象タスク
 * @param params.worktreePath - The task's git worktree (diff source). / worktree
 * @param params.suppressEventLog - Skip the `adversarial_review` timeline write (dry-run callers record their own `dry_run_executed` event instead, keeping judge-calibration data free of non-production verdicts). / タイムライン記録を抑止する（ドライラン専用）
 * @returns The review result. / レビュー結果
 */
export async function reviewDiffAdversarially(params: {
  taskId: number;
  worktreePath: string | null | undefined;
  suppressEventLog?: boolean;
}): Promise<DiffReviewResult> {
  const { taskId, worktreePath, suppressEventLog } = params;
  if (!isAdversarialReviewEnabled() || !worktreePath) {
    return {
      verdict: 'unknown',
      severity: 0,
      reasons: [],
      judged: false,
      unknownReason: 'disabled',
    };
  }

  // Filled in as the review proceeds, so an exception still has whatever
  // evidence was already read for the risk decision.
  const seen: UnavailableContext = { taskId };
  try {
    // The worktree's ACTUAL fork point, not a guess — resolveBaseRef otherwise
    // tries develop→main→master and takes the first that resolves, which can
    // land on a stale/divergent branch in the target repo (not rapitas itself)
    // and pull in every commit merged into the real base since, misreading
    // pre-existing unrelated features as this task's own scope creep.
    // NOTE: theme.defaultBranch, not AgentExecutionConfig.targetBranch (task
    // 511: that table is only ever populated by the manual settings route and
    // is empty for the entire autonomous pipeline) — resolvePreferredBaseBranch
    // falls back to it only when the theme itself has no default branch set.
    const preferredBaseBranch = await resolvePreferredBaseBranch(taskId);
    const diff = await getDiff(worktreePath, undefined, preferredBaseBranch ?? undefined);
    const diffText = buildJuryDiffText(diff);
    const diffFingerprint = fingerprintDiff(diff);
    seen.changedFiles = diff.map((f) => f.filename);
    seen.diffFingerprint = diffFingerprint;
    if (!diffText.trim()) {
      // No code change to review — the completion gate already governs no-op.
      return { verdict: 'unknown', severity: 0, reasons: [], judged: false };
    }

    const planContent = (await readWorkflowFile(taskId, 'plan')) ?? '';
    seen.planContent = planContent;
    const task = await prisma.task
      .findUnique({
        where: { id: taskId },
        select: {
          title: true,
          description: true,
          acceptanceCriteria: true,
          goals: true,
          constraints: true,
        },
      })
      .catch(() => null);
    seen.title = task?.title;
    seen.description = task?.description;
    const acceptanceCriteria = parseAcceptanceCriteria(task?.acceptanceCriteria);
    const measured = await loadJuryMeasurementInputs(taskId, { worktreePath, diffFingerprint });

    const taskTitle = task?.title ?? `task-${taskId}`;
    const prompt = buildDiffReviewPrompt({
      taskTitle,
      taskDescription: task?.description,
      // Same JSON-string-array encoding as acceptanceCriteria.
      goals: parseAcceptanceCriteria(task?.goals),
      constraints: parseAcceptanceCriteria(task?.constraints),
      planContent,
      acceptanceCriteria,
      diffText,
      measuredVerification: measured.measuredVerification,
      verifyClaim: measured.verifyClaim,
    });

    // Two blind reviewers (same prompt, separate calls); the verifier seat
    // only on a disagreement, shown only the disputed findings.
    const run = await runTwoSeatJury(
      prompt,
      { taskTitle, acceptanceCriteria, planContent, diffText },
      { taskId },
    );
    const jurors = run.result.jurors ?? [];
    seen.jurors = jurors;
    // A fail about a plan item that a sibling PR already put on the base ref can
    // never be fixed by the diff — drop it deterministically (task 1196).
    const { applyBaseSatisfiedFilter } = await import('./base-satisfied-plan-items');
    let result = await applyBaseSatisfiedFilter(run.result, {
      worktreePath,
      preferredBaseBranch,
      planContent,
      changedFiles: seen.changedFiles,
    });
    if (result.verdict === 'unknown') result = await decideUnavailableJury(seen, result);

    // Durable per-seat record for judge-reliability calibration; skipped for
    // dry runs (suppressEventLog) — a dry-run verdict isn't a realized outcome.
    if (!suppressEventLog) {
      void appendEvent({
        eventType: 'adversarial_review',
        actorType: 'system',
        payload: {
          taskId,
          form: 'two_seat',
          verdict: result.verdict,
          severity: result.severity,
          jurors: jurors.map((j) => ({
            provider: j.provider,
            model: j.model,
            seatId: (j as { seatId?: string }).seatId,
            role: (j as { role?: string }).role,
            verdict: j.verdict,
            severity: j.severity,
            reasons: j.reasons,
            unknownReason: j.unknownReason,
            findings: j.findings,
            costUsd: j.usage?.costUsd,
            tokensUsed: j.usage?.tokensUsed,
          })),
          seats: result.seats ?? [],
          seating: run.seating, // who sat where and why, incl. unmet seats (追補5)
          // Findings of both reviewers, kept on PASS too (minor → recorded
          // only), with the verifier's check on the disputed ones.
          findings: result.findings ?? [],
          dispute: result.dispute,
          awaitingHuman: result.awaitingHuman,
          unavailableRisk: result.unavailableRisk,
          // Whether the jury saw a measured verification (independence audit),
          // and whether one existed but was about another diff/worktree.
          measuredInput: measured.measuredVerification != null,
          measurementStale: measured.stale,
          diffFingerprint,
          // Seats planned vs seats asked, so a review that ran on one reviewer
          // never reads as a full panel.
          panel: summarisePanel({
            planned: run.planned.map((seat) => ({ label: seat.seatId })),
            asked: run.asked.map((seat) => ({ label: seat.seatId })),
            jurors: jurors.map((j) => ({
              label: (j as { seatId?: string }).seatId ?? `${j.provider}:${j.model ?? ''}`,
              verdict: j.verdict,
              unknownReason: j.unknownReason,
            })),
          }),
        },
        correlationId: `task-${taskId}`,
      }).catch(() => {});
      // Spend of this review (verifier included), as AgentExecution rows under
      // the task's newest session (dry runs skip it with the event).
      const { recordReviewCost } = await import('./review-cost-record');
      await recordReviewCost({ taskId, jurors, verdict: result.verdict });
    }

    log.info(
      {
        taskId,
        verdict: result.verdict,
        severity: result.severity,
        seats: (result.seats ?? []).map((s) => `${s.seatId}:${s.verdict}`).join(','),
      },
      '[adversarial-review] Review outcome',
    );
    return { ...result, diffFingerprint };
  } catch (err) {
    // The gate was on and the pipeline broke — distinct from 'disabled',
    // which is the operator switching it off. Same risk policy as an
    // unavailable jury, on whatever evidence was read before the error.
    log.warn({ err, taskId }, '[adversarial-review] Review errored');
    return decideUnavailableJury(seen, {
      verdict: 'unknown',
      severity: 0,
      reasons: [],
      judged: false,
      unknownReason: 'error',
    }).catch(() => ({
      verdict: 'unknown' as const,
      severity: 0,
      reasons: [],
      judged: false,
      unknownReason: 'error' as const,
    }));
  }
}
