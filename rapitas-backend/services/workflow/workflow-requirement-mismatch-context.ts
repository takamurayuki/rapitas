/**
 * Workflow Requirement-Mismatch Context
 *
 * Turns a SYSTEM-detected requirement/plan mismatch (an acceptance criterion
 * referencing the supervisor's own investigation scratch path) into a
 * planner prompt section carrying the flagged criterion plus the current
 * plan, so the planner resolves the mismatch instead of silently
 * regenerating the same plan.
 *
 * Deliberately a SEPARATE path from workflow-plan-revision-context.ts: that
 * module renders a human's instruction as "human request — highest
 * priority". This module's trigger is verify-requirement-plan-mismatch.ts's
 * automated detection and must never be presented as if a human asked for it
 * (task 909) — the header and body explicitly say "system-detected".
 *
 * Not responsible for dispatching the planner or for applying the edit.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { REQUIREMENT_MISMATCH_CAUSE } from './verify-requirement-plan-mismatch';

const log = createLogger('workflow:requirement-mismatch-context');

/** Hard cap on the injected plan body — bounds prompt growth on huge plans. */
const MAX_PLAN_CHARS = 20000;

const TEXT = {
  ja: {
    header: '# 要件と計画の不整合（システムによる自動検出 — 人間からの指示ではない）',
    lead: [
      'システムが機械的に検出しました。以下の受入基準が、監督/検証者自身の調査記録・専用スクラッチパス（`.supervisor/` 配下等）を参照しており、実装対象として充足不可能です。',
      'これは人間からの指示ではなく機械的な検出結果です。次のいずれかで解消してください。',
      '- その受入基準がこのタスクの実装義務ではなく調査証跡の記述である場合、受入基準からその項目を除外する',
      '- その受入基準が正当な実装対象を指している場合、計画にその対応を明示的に追加する',
    ].join('\n'),
    criterionHeader: '## システムが検出した対象基準',
    planHeader: '## 現在の計画（この内容を改訂する）',
  },
  en: {
    header: '# Requirement-plan mismatch (SYSTEM-detected automatically — NOT a human instruction)',
    lead: [
      "The system mechanically detected that the acceptance criterion below references the supervisor/verifier's own investigation scratch path (e.g. under `.supervisor/`), which cannot be a legitimate implementation target.",
      'This is a mechanical detection, not a human request. Resolve it by either:',
      '- removing the criterion from acceptance criteria if it is investigation narrative rather than an implementation requirement, or',
      '- explicitly adding the corresponding work to the plan if the criterion legitimately targets that path.',
    ].join('\n'),
    criterionHeader: '## Criterion flagged by the system',
    planHeader: '## Current plan (revise this)',
  },
} as const;

/**
 * Render the requirement-mismatch section. Pure — testable without a database.
 *
 * @param criterion - The mismatched acceptance criterion. / 不整合と判定された受入基準
 * @param currentPlan - The plan to revise. / 改訂対象の計画
 * @param language - Output language. / 出力言語
 * @returns Markdown section, or '' when there is nothing to inject. / 注入する節
 */
export function renderRequirementMismatchContext(
  criterion: string,
  currentPlan: string,
  language: 'ja' | 'en',
): string {
  const trimmed = criterion.trim();
  if (!trimmed) return '';
  const t = TEXT[language];
  const plan =
    currentPlan.length > MAX_PLAN_CHARS
      ? `${currentPlan.slice(0, MAX_PLAN_CHARS)}\n\n…(以降は長さ上限により省略)`
      : currentPlan;
  return [t.header, '', t.lead, '', t.criterionHeader, trimmed, '', t.planHeader, plan].join('\n');
}

/**
 * The mismatched criterion still awaiting a plan revision, if any.
 *
 * Staleness is decided by timestamp, mirroring
 * workflow-plan-revision-context.ts's getPendingPlanRevision: a mismatch
 * older than the current plan.md has already been addressed by the run that
 * saved it, so it must not be injected again into an unrelated later run.
 *
 * @param taskId - Task being planned. / 対象タスクID
 * @returns The pending criterion, or null. / 未解消の基準、無ければ null
 */
export async function getPendingRequirementMismatch(taskId: number): Promise<string | null> {
  try {
    const [request, plan] = await Promise.all([
      prisma.workflowTransition.findFirst({
        where: { taskId, cause: REQUIREMENT_MISMATCH_CAUSE },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, metadata: true },
      }),
      prisma.workflowFile.findFirst({
        where: { taskId, fileType: 'plan' },
        select: { updatedAt: true },
      }),
    ]);
    if (!request) return null;
    if (plan && plan.updatedAt >= request.createdAt) return null;

    const parsed: unknown = JSON.parse(request.metadata ?? '{}');
    const criterion =
      parsed && typeof parsed === 'object'
        ? (parsed as { criterion?: unknown }).criterion
        : undefined;
    return typeof criterion === 'string' && criterion.trim() ? criterion : null;
  } catch (err) {
    log.warn({ err, taskId }, '[requirement-mismatch-context] failed to read pending mismatch');
    return null;
  }
}

/**
 * Build the planner-context section for a pending requirement-plan mismatch.
 *
 * @param taskId - Task being planned. / 対象タスクID
 * @param currentPlan - plan.md as it stands. / 現在の plan.md
 * @param language - Output language. / 出力言語
 * @returns The section, or '' when no mismatch is pending. / 節、無ければ空文字
 */
export async function buildRequirementMismatchContext(
  taskId: number,
  currentPlan: string | null,
  language: 'ja' | 'en',
): Promise<string> {
  if (!currentPlan) return '';
  const criterion = await getPendingRequirementMismatch(taskId);
  if (!criterion) return '';
  log.info(
    { taskId },
    '[requirement-mismatch-context] injecting requirement-mismatch context into planner context',
  );
  return renderRequirementMismatchContext(criterion, currentPlan, language);
}
