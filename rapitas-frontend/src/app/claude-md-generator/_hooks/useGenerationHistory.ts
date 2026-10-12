'use client';
// use-generation-history

import { useState } from 'react';
import type { GenerateResult } from '../_types/types';
import type { ReviewSpecResult } from '../../api/review-spec/review-prompt';

/**
 * One generated document package, kept so the user can go back to it.
 *
 * NOTE: the wizard previously held only the LATEST package, so revisiting an
 * earlier version meant regenerating it — a fresh model call whose output is
 * not even guaranteed to match. Reported 2026-10-12: 「一度生成した内容は履歴で
 * 確認＆再度選択出来るようにして無駄な再生成しないようにしたい」.
 */
export interface GenerationEntry {
  /** 1-based, in generation order. / 生成順(1始まり) */
  round: number;
  result: GenerateResult;
  /** The review that followed, when one ran. / 直後のレビュー結果 */
  review: ReviewSpecResult | null;
  /** The answers folded into this generation, for the label. / この生成に反映した回答 */
  answersBlock?: string;
  /** Local time the package was produced. / 生成時刻 */
  at: number;
}

/**
 * Entries kept. Each holds four documents, so the cap bounds memory while
 * covering more rounds than MAX_REVIEW_ROUNDS can produce.
 */
export const MAX_HISTORY = 6;

/**
 * Append one entry, dropping the oldest past the cap.
 *
 * Pure so the cap and the ordering are testable without React.
 *
 * @param history - Entries so far, oldest first / これまでの履歴
 * @param entry - The new entry / 追加する履歴
 * @returns The new list, oldest first / 新しい履歴（古い順）
 */
export function appendHistory(
  history: readonly GenerationEntry[],
  entry: GenerationEntry,
): GenerationEntry[] {
  const next = [...history, entry];
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
}

/**
 * A short label for one entry, so the list is scannable.
 *
 * Counts the features the package declares rather than showing a byte size:
 * the user is choosing between versions of a specification, and the feature
 * count plus the finding count is what distinguishes them.
 *
 * @param entry - The entry to describe / 対象の履歴
 * @returns One-line summary / 1行の要約
 */
export function describeEntry(entry: GenerationEntry): string {
  // DISTINCT ids, not bullet lines: the 受け入れ基準 section repeats every id
  // (three criteria per feature by design), so counting lines reported 4 for a
  // 3-feature document.
  const ids = new Set(
    ((entry.result.requirements ?? '').match(/[[［]\s*(F-\d+)\s*[\]］]/g) ?? []).map((m) =>
      m.replace(/[^F\d-]/g, ''),
    ),
  );
  const features = ids.size;
  const errors = (entry.review?.findings ?? []).filter((f) => f.severity === 'error').length;
  const warnings = (entry.review?.findings ?? []).filter((f) => f.severity === 'warning').length;
  const parts = [`機能 ${features} 件`];
  if (entry.review) parts.push(errors === 0 ? '要対応なし' : `要対応 ${errors} 件`);
  if (warnings > 0) parts.push(`警告 ${warnings} 件`);
  if (entry.answersBlock) parts.push('回答を反映');
  return parts.join(' / ');
}

/**
 * Keeps every package this wizard session generated, and restores one on
 * request.
 *
 * @returns The history and the actions over it / 履歴と操作
 */
export function useGenerationHistory() {
  const [history, setHistory] = useState<GenerationEntry[]>([]);

  /**
   * Record one generated package.
   *
   * @param entry - Everything needed to restore it later / 復元に必要な一式
   */
  const record = (entry: Omit<GenerationEntry, 'round' | 'at'>) => {
    setHistory((prev) => appendHistory(prev, { ...entry, round: prev.length + 1, at: Date.now() }));
  };

  const reset = () => setHistory([]);

  return { history, record, reset };
}
