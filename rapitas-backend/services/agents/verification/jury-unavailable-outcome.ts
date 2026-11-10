/**
 * jury-unavailable-outcome
 *
 * What a review becomes when the jury could not decide it (no reviewer
 * answered, or the review errored): the evidence-based risk
 * (jury-unavailable-risk.ts) decides between proceeding with the gap recorded
 * (low risk, verdict 'unknown') and parking the task for a human (high risk,
 * verdict 'hold'). Not responsible for writing the hold itself.
 *
 * NOTE: High risk used to fail CLOSED with a synthetic 'fail', which the
 * callers then bounced to the implementer as "repair this" — for a diff nobody
 * had judged, so the repair could only re-submit the same thing.
 */
import { prisma } from '../../../config/database';
import { readWorkflowFile } from '../../workflow/workflow-file-utils';
import {
  resolveJuryUnavailableRisk,
  type JuryUnavailableRisk,
} from '../../workflow/jury-unavailable-risk';
import type { DiffReviewResult, JurorVerdict } from './adversarial-diff-review-verdict';

/** Japanese label for where the high-risk decision came from (shown to the human). */
const RISK_SOURCE_LABELS: Record<JuryUnavailableRisk['source'], string> = {
  diff_paths: '差分が高リスクのパスを変更している',
  research_verdict: '調査のリスク判定が「高」',
  declared_files: '計画が高リスクのファイルを変更対象にしている',
  evidence_clear: '根拠上は高リスクではない',
  keyword_fallback: '根拠が無く、タスク文に高リスクの語がある',
};

function riskDetail(risk: JuryUnavailableRisk): string {
  const files = risk.files?.length ? `（${risk.files.slice(0, 3).join(', ')}）` : '';
  return `リスクの根拠: ${RISK_SOURCE_LABELS[risk.source]}${files}`;
}

/** What the review had read before it found itself undecided. */
export interface UnavailableContext {
  taskId: number;
  changedFiles?: string[];
  diffFingerprint?: string | null;
  planContent?: string;
  title?: string | null;
  description?: string | null;
  jurors?: JurorVerdict[];
}

/**
 * Decide an undecided review on evidence. Reads research.md (and plan.md /
 * the task when the review had not got that far). Never throws for read errors.
 *
 * @param ctx - What the review had already read / 既に読んだ情報
 * @param base - The undecided result (verdict 'unknown') / 未決の結果
 * @returns 'unknown' with the risk recorded, or 'hold' for high risk / 判定
 */
export async function decideUnavailableJury(
  ctx: UnavailableContext,
  base: DiffReviewResult,
): Promise<DiffReviewResult> {
  const research = await readWorkflowFile(ctx.taskId, 'research').catch(() => null);
  const planContent =
    ctx.planContent ?? (await readWorkflowFile(ctx.taskId, 'plan').catch(() => null)) ?? '';
  let { title, description } = ctx;
  if (title === undefined) {
    const t = await prisma.task
      .findUnique({ where: { id: ctx.taskId }, select: { title: true, description: true } })
      .catch(() => null);
    title = t?.title ?? null;
    description = t?.description ?? null;
  }
  const risk = resolveJuryUnavailableRisk({
    changedFiles: ctx.changedFiles,
    researchContent: research,
    planContent,
    title,
    description,
  });
  const recorded = {
    ...base,
    ...(ctx.jurors ? { jurors: ctx.jurors } : {}),
    ...(ctx.diffFingerprint !== undefined ? { diffFingerprint: ctx.diffFingerprint } : {}),
    unavailableRisk: risk,
  };
  if (!risk.high) return recorded;
  return {
    ...recorded,
    verdict: 'hold',
    severity: 70,
    reasons: [
      '差分レビューが成立しませんでした（レビュー席が応答なし、またはレビューが失敗）。根拠に基づくリスク判定が高リスクのため、人間の判断を待ちます。',
    ],
    awaitingHuman: {
      reason: 'jury_unavailable_high_risk',
      detail: riskDetail(risk),
    },
  };
}
