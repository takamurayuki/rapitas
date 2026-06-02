/**
 * api
 *
 * API call helpers and label-resolution utilities for the CLAUDE.md generator.
 * All network requests to /api/* routes are contained here so the wizard
 * components remain free of fetch logic.
 */

import type { AppAnswers, AppProposal, DynamicItem } from '../_types/types';

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
) {
  const genre = t('genre_' + answers.genre);
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
 * @returns raw API response with `proposals` array / proposalsを含む生のAPIレスポンス
 * @throws {Error} when the HTTP response is not ok or contains a top-level error field
 */
export async function proposeApps(
  t: (key: string) => string,
  answers: AppAnswers,
  dynSubs?: DynamicItem[],
  dynElems?: DynamicItem[],
) {
  const { genre, subs, elems, plat, scale, prio } = resolveLabels(t, answers, dynSubs, dynElems);

  const response = await fetch('/api/generate-proposals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ genre, subs, elems, plat, scale, prio }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}: プロポーザル生成に失敗しました`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(data.error);
  }
  // NOTE: aiFailed with errorMessage is handled by the caller, not thrown here.
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
) {
  const { genre, subs, elems, plat, scale, prio } = resolveLabels(t, answers, dynSubs, dynElems);

  const response = await fetch('/api/generate-claude-md', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ genre, subs, elems, plat, scale, prio, proposal }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}: CLAUDE.md生成に失敗しました`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(data.error);
  }
  return data;
}
