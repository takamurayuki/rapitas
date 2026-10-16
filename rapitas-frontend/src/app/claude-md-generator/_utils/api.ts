/**
 * api
 *
 * API call helpers and label-resolution utilities for the CLAUDE.md generator.
 * All network requests to /api/* routes are contained here so the wizard
 * components remain free of fetch logic.
 */

import type { AppAnswers, AppProposal, DynamicItem, ProjectContext } from '../_types/types';
import type { ReviewSpecResult } from '../../api/review-spec/review-prompt';

/**
 * Resolves human-readable labels for all wizard answers using the i18n function.
 *
 * @param t - next-intl translation function / next-intl翻訳関数
 * @param answers - current wizard answers / ウィザードの回答
 * @param dynSubs - AI-generated sub-genre items / AIが生成したサブジャンル一覧
 * @param dynElems - AI-generated element items / AIが生成した要素一覧
 * @returns object with resolved label strings / 解決済みラベル文字列のオブジェクト
 */
export function resolveLabels(
  t: (key: string) => string,
  answers: AppAnswers,
  dynSubs?: DynamicItem[],
  dynElems?: DynamicItem[],
  dynGenres?: readonly DynamicItem[],
) {
  // NOTE: a concept-proposed genre has no translation key, so `t()` would send
  // the key itself ("genre_ai_meeting_actions") to the proposal prompt as if it
  // were the genre name. Dynamic items win, exactly as they already do for
  // sub-genres and elements below.
  const genre =
    dynGenres?.find((g) => g.id === answers.genre)?.label || t('genre_' + answers.genre);
  const subs = (answers.subs || [])
    .map((id: string) => {
      const dynItem = dynSubs?.find((s) => s.id === id);
      return dynItem?.label || t(`sub_${answers.genre}_${id}`);
    })
    .filter(Boolean)
    .join('、');
  const elems = (answers.elements || [])
    .map((id: string) => {
      const dynItem = dynElems?.find((e) => e.id === id);
      return dynItem?.label || t('elem_' + id);
    })
    .filter(Boolean)
    .join('、');
  const plat = t('plat_' + answers.platform);
  const scale = t('scale_' + answers.scale);
  const prio = t('prio_' + answers.priority);
  return { genre, subs, elems, plat, scale, prio };
}

/**
 * Calls the AI endpoint to generate app proposals based on wizard answers.
 *
 * @param t - next-intl translation function / next-intl翻訳関数
 * @param answers - wizard answers to build the prompt from / プロンプト構築用ウィザード回答
 * @param dynSubs - AI-generated sub-genre items / AIが生成したサブジャンル一覧
 * @param dynElems - AI-generated element items / AIが生成した要素一覧
 * @param dynGenres - concept-proposed genre items / 題材から提案されたジャンル一覧
 * @returns raw API response with `proposals` array / proposalsを含む生のAPIレスポンス
 * @throws {Error} when the HTTP response is not ok or contains a top-level error field
 */
export async function proposeApps(
  t: (key: string) => string,
  answers: AppAnswers,
  dynSubs?: DynamicItem[],
  dynElems?: DynamicItem[],
  dynGenres?: readonly DynamicItem[],
) {
  const { genre, subs, elems, plat, scale, prio } = resolveLabels(
    t,
    answers,
    dynSubs,
    dynElems,
    dynGenres,
  );

  const response = await fetch('/api/generate-proposals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ genre, subs, elems, plat, scale, prio }),
  });

  if (!response.ok) {
    // NOTE: Prefer the translated fallback over the raw API error string —
    // the route may return Japanese prose regardless of the user's locale.
    throw new Error(t('proposalGenerateFailed'));
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(t('proposalGenerateFailed'));
  }
  // NOTE: aiFailed with errorCode is handled by the caller, not thrown here.
  return data;
}

/**
 * Calls the AI endpoint to generate the full CLAUDE.md for a chosen proposal.
 *
 * @param t - next-intl translation function / next-intl翻訳関数
 * @param answers - wizard answers / ウィザードの回答
 * @param proposal - the app proposal selected by the user / ユーザーが選択したアプリ提案
 * @param dynSubs - AI-generated sub-genre items / AIが生成したサブジャンル一覧
 * @param dynElems - AI-generated element items / AIが生成した要素一覧
 * @returns GenerateResult-shaped data from the API / APIからのGenerateResult形式データ
 * @throws {Error} when the HTTP response is not ok or contains a top-level error field
 */
export async function generateClaudeMd(
  t: (key: string) => string,
  answers: AppAnswers,
  proposal: AppProposal,
  dynSubs?: DynamicItem[],
  dynElems?: DynamicItem[],
  /** Elicited project facts; blank fields are sent as 未確認. / ヒアリング結果 */
  context?: ProjectContext,
  /** Answers to a previous review round, when regenerating. / 壁打ちの回答 */
  reviewAnswers?: string,
  /** Concept-proposed genre items, so a proposed genre keeps its label. / 題材から提案されたジャンル */
  dynGenres?: readonly DynamicItem[],
) {
  const { genre, subs, elems, plat, scale, prio } = resolveLabels(
    t,
    answers,
    dynSubs,
    dynElems,
    dynGenres,
  );

  const response = await fetch('/api/generate-claude-md', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      genre,
      subs,
      elems,
      plat,
      scale,
      prio,
      proposal,
      context,
      reviewAnswers,
    }),
  });

  if (!response.ok) {
    // NOTE: Prefer the translated fallback over the raw API error string —
    // the route may return Japanese prose regardless of the user's locale.
    throw new Error(t('claudeMdGenerateFailed'));
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(t('claudeMdGenerateFailed'));
  }
  return data;
}

/**
 * Review a generated package: mechanical findings plus the decisions the model
 * made on its own authority.
 *
 * @param docs - The generated documents / 生成された文書
 * @returns Findings and questions / 指摘と質問
 * @throws {Error} When the review route itself fails / レビュー経路が失敗した場合
 */
export async function reviewSpec(docs: {
  requirements?: string;
  design?: string;
  adr?: string;
}): Promise<ReviewSpecResult> {
  const response = await fetch('/api/review-spec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requirements: docs.requirements,
      design: docs.design,
      adr: docs.adr,
    }),
  });
  if (!response.ok) throw new Error('review failed');
  const data = await response.json();
  if (data.error) throw new Error('review failed');
  return data as ReviewSpecResult;
}
