/**
 * 質問判定システム - バリデーション & パース
 */

import type { QuestionKey } from './types';

/**
 * QuestionKeyの妥当性を検証
 */
export function validateQuestionKey(key: unknown): key is QuestionKey {
  if (!key || typeof key !== 'object') {
    return false;
  }

  const obj = key as Record<string, unknown>;

  // 必須フィールドの存在チェック
  if (
    typeof obj.status !== 'string' ||
    typeof obj.question_id !== 'string' ||
    typeof obj.question_type !== 'string' ||
    typeof obj.requires_response !== 'boolean'
  ) {
    return false;
  }

  // status値の検証
  const validStatuses = ['awaiting_user_input', 'processing', 'completed'];
  if (!validStatuses.includes(obj.status)) {
    return false;
  }

  // question_type値の検証
  const validTypes = ['clarification', 'confirmation', 'selection'];
  if (!validTypes.includes(obj.question_type)) {
    return false;
  }

  // timeout_secondsがある場合は数値であることを確認
  if (obj.timeout_seconds !== undefined && typeof obj.timeout_seconds !== 'number') {
    return false;
  }

  return true;
}

/**
 * 文字列からQuestionKeyをパース（将来の直接キー返却方式用）
 */
export function parseQuestionKeyFromString(str: string): QuestionKey | null {
  try {
    const parsed = JSON.parse(str);
    if (validateQuestionKey(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * オブジェクトからQuestionKeyを抽出（将来の直接キー返却方式用）
 */
export function extractQuestionKeyFromObject(obj: Record<string, unknown>): QuestionKey | null {
  // オブジェクト自体がQuestionKeyの場合
  if (validateQuestionKey(obj)) {
    return obj;
  }

  // ネストされた場所にある場合を探索
  const possibleLocations = ['questionKey', 'question_key', 'key', 'response'];
  for (const loc of possibleLocations) {
    if (obj[loc] && validateQuestionKey(obj[loc])) {
      return obj[loc] as QuestionKey;
    }
  }

  return null;
}
