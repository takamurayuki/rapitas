/**
 * resume-condition/questions
 *
 * Maps a blocked-task stop reason to the ONE question that can unblock it.
 * Reasons no human answer can change yield `not_resumable` (zero questions).
 */
import {
  REPAIR_STRATEGY_CHOICES,
  RESUMABLE_REASONS,
  type ResumableReason,
  type ResumeQuestionResult,
} from './types';

/**
 * Narrow a classification to a releasable reason.
 *
 * @param reason - Any classification string. / 分類文字列
 * @returns True when an approved condition may release it. / 解除可能か
 */
export function isResumableReason(reason: string): reason is ResumableReason {
  return (RESUMABLE_REASONS as readonly string[]).includes(reason);
}

/**
 * Build the single question for a stop reason.
 *
 * @param reason - Exclusion classification. / 停止理由
 * @returns The question, or `not_resumable` when no answer can change the outcome. / 質問または不可
 */
export function buildResumeQuestion(reason: string): ResumeQuestionResult {
  switch (reason) {
    case 'retry_cap_exhausted':
      return {
        kind: 'question',
        reason,
        text: '前回の失敗原因を修正済みですか？',
        spec: 'boolean',
      };
    case 'pr_recovery_exhausted':
      return {
        kind: 'question',
        reason,
        text: 'git と gh の認証およびリモートの問題を解消済みですか？',
        spec: 'boolean',
      };
    case 'verify_repair_exhausted':
      return {
        kind: 'question',
        reason,
        text: 'どの方針で再試行しますか？',
        spec: 'choice',
        choices: REPAIR_STRATEGY_CHOICES,
      };
    case 'verify_no_convergence':
      return {
        kind: 'question',
        reason,
        text: '非収束だった基準を解消した修正ファイル（リポジトリ相対パス）はどれですか？',
        spec: 'file_path',
      };
    default:
      return { kind: 'not_resumable', reason };
  }
}
