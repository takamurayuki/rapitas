/**
 * workflow-decision-context
 *
 * Builds the 意思決定ジャーナル (Decision Journal) block injected into the PLANNER
 * prompt so prior settled choices for this theme are REUSED rather than
 * re-litigated: it lists recent decisions (choice + rationale + how the
 * prediction calibrated) so the new plan aligns with — or deliberately revisits —
 * them. Recording lives in decision-from-plan; this is the read-back that makes
 * the journal actually leveraged in agent reasoning.
 */
import { prisma } from '../../config/database';
import { listDecisions, type DecisionEntry } from '../memory/decision-journal-service';

/** How many recent decisions to surface (keep the prompt bounded). */
const MAX_DECISIONS = 6;

/** Calibration verdict labels for the prompt. */
const CALIB_JA: Record<string, string> = {
  pending: '未レビュー',
  correct: '的中',
  partial: '部分的',
  wrong: '外れ',
};

/** One-line summary of a decision for the prompt. */
function line(d: DecisionEntry, ja: boolean): string {
  const conf = Math.round(d.confidence * 100);
  const calib = ja ? (CALIB_JA[d.calibration] ?? d.calibration) : d.calibration;
  const why = d.rationale ? ` — ${d.rationale}` : '';
  return `- ${d.decision}（確信度${conf}%・${calib}）${why}`;
}

/**
 * Builds the decision-journal context block for a task's theme. Returns '' when
 * there are no decisions yet or on error.
 *
 * @param taskId - The task being planned (for theme resolution). / 対象タスクID
 * @param language - Prompt language. / プロンプト言語
 * @returns The block, or '' when empty / on error. / 注入ブロック
 */
export async function buildDecisionContext(
  taskId: number,
  language: 'ja' | 'en' = 'ja',
): Promise<string> {
  try {
    const taskRow = await prisma.task
      .findUnique({ where: { id: taskId }, select: { themeId: true } })
      .catch(() => null);
    const themeId = taskRow?.themeId ?? undefined;

    const { decisions } = await listDecisions({ status: 'all', themeId, limit: MAX_DECISIONS });
    if (decisions.length === 0) return '';

    const ja = language === 'ja';
    const parts: string[] = [];
    parts.push(
      ja
        ? '# 意思決定ジャーナル（このテーマの確定済み判断）'
        : '# Decision Journal (settled choices for this theme)',
    );
    parts.push(
      ja
        ? '以下は過去に確定した設計判断です。**既存の選択を踏襲し、矛盾する再決定を避けよ。** 「外れ」と記録された判断は繰り返さないこと。意図的に別の選択をする場合のみ、plan.md の `## 意思決定` で理由を明示せよ。'
        : 'These are settled design choices. **REUSE them and avoid contradictory re-decisions.** Do not repeat a decision marked "wrong". Only choose differently with an explicit justification in plan.md `## 意思決定`.',
    );
    parts.push(decisions.map((d) => line(d, ja)).join('\n'));
    return parts.join('\n\n');
  } catch {
    return '';
  }
}
