/**
 * 質問判定システム - タイムアウト管理
 */

import type { QuestionKey } from "./types";
import {
  DEFAULT_QUESTION_TIMEOUT_SECONDS,
  MIN_QUESTION_TIMEOUT_SECONDS,
  MAX_QUESTION_TIMEOUT_SECONDS,
} from "./constants";

/**
 * タイムアウト秒数を正規化（範囲内に収める）
 */
export function normalizeTimeoutSeconds(timeoutSeconds?: number): number {
  if (timeoutSeconds === undefined || timeoutSeconds === null) {
    return DEFAULT_QUESTION_TIMEOUT_SECONDS;
  }

  if (timeoutSeconds < MIN_QUESTION_TIMEOUT_SECONDS) {
    return MIN_QUESTION_TIMEOUT_SECONDS;
  }

  if (timeoutSeconds > MAX_QUESTION_TIMEOUT_SECONDS) {
    return MAX_QUESTION_TIMEOUT_SECONDS;
  }

  return Math.floor(timeoutSeconds);
}

/**
 * 質問タイムアウト期限を計算
 * @param questionKey 質問キー情報
 * @param startTime 質問開始時刻（省略時は現在時刻）
 * @returns タイムアウト期限のDate
 */
export function calculateTimeoutDeadline(
  questionKey: QuestionKey,
  startTime?: Date
): Date {
  const start = startTime || new Date();
  const timeoutMs = (questionKey.timeout_seconds || DEFAULT_QUESTION_TIMEOUT_SECONDS) * 1000;
  return new Date(start.getTime() + timeoutMs);
}

/**
 * 質問がタイムアウトしたかどうかを判定
 * @param questionKey 質問キー情報
 * @param startTime 質問開始時刻
 * @returns タイムアウトしていればtrue
 */
export function isQuestionTimedOut(
  questionKey: QuestionKey,
  startTime: Date
): boolean {
  const deadline = calculateTimeoutDeadline(questionKey, startTime);
  return new Date() >= deadline;
}

/**
 * タイムアウトまでの残り秒数を取得
 * @param questionKey 質問キー情報
 * @param startTime 質問開始時刻
 * @returns 残り秒数（0以下の場合はタイムアウト済み）
 */
export function getRemainingTimeoutSeconds(
  questionKey: QuestionKey,
  startTime: Date
): number {
  const deadline = calculateTimeoutDeadline(questionKey, startTime);
  const remaining = Math.ceil((deadline.getTime() - Date.now()) / 1000);
  return Math.max(0, remaining);
}
