/**
 * concern-relevance-check
 *
 * Filing-time relevance pre-check for the concern backlog, using Jev
 * (TypeSafe AI's fast/cheap "System-1" decision model, see jev-client.ts)
 * to ask "does this problem still look real, or does it read like something
 * already fixed / a one-off transient blip?" BEFORE a concern is written to
 * the backlog.
 *
 * Existing staleness checks (log-concern-recurrence.ts's
 * isLogConcernStillRecurring, self-detect-relevance.ts's
 * isSelfDetectConcernStillRelevant) only run at PROMOTION time (concern →
 * task) inside backlog-promoter-execute.ts, and only cover log-derived
 * concerns plus 2 of the known [自己検出] signature classes via per-signature
 * regex/DB-lookup code. Manual conversion (routes/memory/concern-backlog.ts)
 * bypasses those checks entirely. This module runs earlier — at filing time,
 * for every concern regardless of source — and judges ANY concern text via
 * natural-language reasoning instead of hand-maintained per-signature code.
 *
 * Fails OPEN unconditionally: no RAPITAS_JEV_API_KEY, any Jev error, or an
 * inconclusive (near-0.5) answer all return null — filing proceeds exactly
 * as before. Only a confident "not relevant" verdict suppresses a filing.
 * Not responsible for deciding what happens on suppression — that stays
 * with concern-backlog-service.ts's submitConcern, which owns the filing
 * pipeline and its existing near-duplicate/theme-saturation gates.
 */
import { createLogger } from '../../config/logger';
import { askJevBoolean, isJevConfigured } from '../ai/jev-client';

const log = createLogger('memory:concern-relevance-check');

/** Context sent to Jev is capped — a concern's detail can carry stack
 * traces or verify.md dumps far larger than a relevance judgment needs. */
const MAX_CONTEXT_CHARS = 4_000;

/**
 * Only a confident verdict acts; a probability near 0.5 means Jev itself is
 * unsure, which must not suppress a possibly-real filing. Tunable because
 * the right threshold can only be set from real production answers, which
 * do not exist yet (Jev is early-access, not yet configured in this repo).
 */
function confidenceThreshold(): number {
  const v = parseFloat(process.env.RAPITAS_JEV_RELEVANCE_THRESHOLD ?? '0.85');
  return Number.isFinite(v) && v > 0.5 && v <= 1 ? v : 0.85;
}

export interface ConcernRelevanceInput {
  title: string;
  detail: string;
}

export interface ConcernRelevanceResult {
  relevant: boolean;
  /** Jev's probability that the concern IS still relevant, in [0, 1]. */
  confidence: number;
}

const RELEVANCE_QUESTION_ID = 'still_relevant';

/**
 * Asks Jev whether a concern report still describes a real, current,
 * actionable problem.
 *
 * @param input - The concern's title and detail as they would be filed. / 起票内容
 * @returns A confident verdict, or null when Jev is unavailable/unconfigured/
 *   unconfident — callers must treat null as "no opinion," never as either
 *   answer. / 確信のある判定、利用不可・判定保留時は null
 */
export async function checkConcernStillRelevant(
  input: ConcernRelevanceInput,
): Promise<ConcernRelevanceResult | null> {
  if (!isJevConfigured()) return null;
  const context =
    `# 懸念報告 (concern report)\n\n## タイトル\n${input.title}\n\n## 詳細\n${input.detail}`.slice(
      0,
      MAX_CONTEXT_CHARS,
    );
  const answers = await askJevBoolean(context, [
    {
      id: RELEVANCE_QUESTION_ID,
      prompt:
        'この懸念報告は、現時点でも実際に対応が必要な、現在進行中の具体的な問題を説明していますか？' +
        '（既に修正済み・一時的なログの誤検知・単発の過渡的なエラーのように見える場合は「いいえ」）',
    },
  ]);
  if (!answers) return null;
  const answer = answers.find((a) => a.id === RELEVANCE_QUESTION_ID);
  if (!answer) return null;

  const threshold = confidenceThreshold();
  if (answer.probability >= threshold) {
    return { relevant: true, confidence: answer.probability };
  }
  if (answer.probability <= 1 - threshold) {
    log.info(
      { title: input.title.slice(0, 80), probability: answer.probability },
      '[concern-relevance] Jev: confidently not relevant',
    );
    return { relevant: false, confidence: 1 - answer.probability };
  }
  // Inconclusive — Jev itself is not confident either way.
  return null;
}
