/**
 * Phase Critic Input
 *
 * Builds the user message a critic lens judges: per-section caps, head+tail
 * truncation and the grounding-context shape. Pure — not responsible for
 * calling the model or aggregating verdicts (phase-critic.ts).
 */

/**
 * Per-section input caps (task 911). The fix there was HOW each section
 * truncates (head+tail, with an explicit marker).
 */
const TASK_BRIEF_MAX_CHARS = 3000;
const REFERENCE_ARTIFACT_MAX_CHARS = 8000;
// NOTE: Raised from 16,000 (task 1593): plan.md runs 20k-36k chars, so most plan
// critiques judged a cut document. All sections at their cap stay well under
// the CLI prompt limit (see phase-critic.input.test.ts).
const ARTIFACT_MAX_CHARS = 40_000;
const ACCEPTANCE_CRITERIA_MAX_CHARS = 4000;

/** Marker inserted where a section's middle was cut. */
const TRUNCATION_MARKER =
  '\n\n…[中略: 文字数上限のため中間部分を省略。原文はここで終わっていません]\n\n';

/** Banner prepended to the critic input when any section was truncated. */
const TRUNCATION_BANNER =
  '⚠️ 注意: 以下の文書の一部は文字数上限により中略されています（「…[中略: …]」マーカー参照）。' +
  '中略部分の内容を「記載がない」「未完成」と判定しないでください。' +
  '中略はこの入力の表示上の制約であり、原文の欠落を意味しません。';

/**
 * Truncates text to at most maxChars while preserving BOTH the head and the
 * tail — a long document's opening context (what was investigated) and its
 * closing content (conclusions, corrections, hand-off notes) are both kept
 * visible instead of only the head surviving a naive slice(0, maxChars).
 * Exported for tests.
 *
 * @param text - Text to bound. / 対象テキスト
 * @param maxChars - Maximum length of the returned text. / 上限文字数
 * @returns The bounded text and whether truncation occurred. / 整形結果と切断有無
 */
export function truncateWithNotice(
  text: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  const budget = Math.max(0, maxChars - TRUNCATION_MARKER.length);
  const headLen = Math.floor(budget * 0.6);
  const tailLen = budget - headLen;
  const head = text.slice(0, headLen);
  const tail = tailLen > 0 ? text.slice(text.length - tailLen) : '';
  return { text: `${head}${TRUNCATION_MARKER}${tail}`, truncated: true };
}

/**
 * Optional grounding context handed to every lens. Without it the critic can
 * only judge the artifact text in a vacuum — observed failure mode (task 551):
 * the plan critic demanded restating facts that already lived in research.md,
 * and each re-review invented a fresh batch of demands because it never saw
 * what the previous rejection asked for. All fields are best-effort.
 */
export interface CriticContext {
  /** Required grounding could not be loaded; do not judge the artifact in isolation. */
  unavailable?: boolean;
  /** Task title + description the artifact must serve. / タスク要求 */
  taskBrief?: string;
  /** Prior-phase document the artifact builds on (research.md for plan). / 先行フェーズ文書 */
  referenceArtifact?: string;
  /** Reasons from this phase's previous critic rejection. / 前回の差し戻し理由 */
  priorReasons?: string[];
  /**
   * Task's acceptance criteria. Reference material, not a critique target —
   * lets the critic notice when the artifact fails to address a criterion
   * (task 911: without this the gate had no way to see AC3/4/5 at all).
   * / タスクの受入基準。参考資料として渡し、批評対象ではない
   */
  acceptanceCriteria?: string[];
}

/**
 * Assemble the user message a lens critiques: grounding sections first (marked
 * as reference material, not critique targets), the artifact last. Every
 * section is head+tail truncated independently via {@link truncateWithNotice}
 * (task 911) so no section is silently cut, and a warning banner is prepended
 * whenever any section was. Pure — exported for tests.
 *
 * @param content - Artifact body. / アーティファクト本文
 * @param context - Optional grounding context. / 参考資料
 * @returns The composed message, whether any section was cut, and whether the
 *   artifact or the requirements (brief, criteria) were. / レンズに渡す本文、
 *   いずれかの切断有無、対象または要求（タスク要求・受入基準）の切断有無
 */
export function buildCriticUserMessage(
  content: string,
  context?: CriticContext,
): { message: string; truncated: boolean; requirementsOrArtifactTruncated: boolean } {
  const parts: string[] = [];
  let truncated = false;
  let requirementsOrArtifactTruncated = false;

  if (context?.taskBrief?.trim()) {
    const t = truncateWithNotice(context.taskBrief, TASK_BRIEF_MAX_CHARS);
    truncated = truncated || t.truncated;
    requirementsOrArtifactTruncated = requirementsOrArtifactTruncated || t.truncated;
    parts.push(`# タスク要求（参考資料 — 批評対象ではない）\n${t.text}`);
  }
  if (context?.acceptanceCriteria?.length) {
    const list = context.acceptanceCriteria.map((c) => `- ${c}`).join('\n');
    const t = truncateWithNotice(list, ACCEPTANCE_CRITERIA_MAX_CHARS);
    truncated = truncated || t.truncated;
    requirementsOrArtifactTruncated = requirementsOrArtifactTruncated || t.truncated;
    parts.push(
      `# 受入基準（参考資料 — 批評対象ではない。満たせているか判断材料にすること）\n${t.text}`,
    );
  }
  if (context?.referenceArtifact?.trim()) {
    const t = truncateWithNotice(context.referenceArtifact, REFERENCE_ARTIFACT_MAX_CHARS);
    truncated = truncated || t.truncated;
    parts.push(
      `# 先行フェーズ文書（参考資料 — 批評対象ではない。ここに既にある情報の再記載を要求しないこと）\n${t.text}`,
    );
  }
  if (context?.priorReasons?.length) {
    const reasons = context.priorReasons
      .slice(0, 8)
      .map((r) => `- ${r}`)
      .join('\n');
    parts.push(`# 前回の批評指摘（この文書は指摘を受けて改訂済み）\n${reasons}`);
  }
  {
    const t = truncateWithNotice(content, ARTIFACT_MAX_CHARS);
    truncated = truncated || t.truncated;
    requirementsOrArtifactTruncated = requirementsOrArtifactTruncated || t.truncated;
    parts.push(`# 批評対象アーティファクト\n${t.text}`);
  }

  const message = truncated ? `${TRUNCATION_BANNER}\n\n${parts.join('\n\n')}` : parts.join('\n\n');
  return { message, truncated, requirementsOrArtifactTruncated };
}
