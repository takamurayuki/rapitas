/**
 * resume-condition/parse-answer
 *
 * Converts a raw answer into a typed ResumeConditionSpec. Free text is never
 * accepted as-is: each stop reason allows exactly one condition type and
 * anything that does not fit is rejected.
 */
import { REPAIR_STRATEGY_CHOICES, type ResumableReason, type ResumeConditionSpec } from './types';

/** Parse outcome. */
export type ParseAnswerResult =
  | { ok: true; spec: ResumeConditionSpec }
  | { ok: false; error: string };

/**
 * Validate a repo-relative path: no absolute form, drive letter, or `..` segment.
 *
 * @param p - Candidate path. / 候補パス
 * @returns True when it stays inside the repository by construction. / リポジトリ内に収まるか
 */
export function isSafeRelativePath(p: string): boolean {
  if (!p || p.length > 500 || p.includes('\u0000')) return false;
  if (p.startsWith('/') || p.startsWith('\\') || /^[A-Za-z]:/.test(p)) return false;
  return !p.split(/[\\/]+/).some((seg) => seg === '..');
}

/**
 * Convert an answer to a typed condition for the given stop reason.
 *
 * @param reason - Stop reason the question was asked for. / 停止理由
 * @param answer - Raw answer from the client. / 回答
 * @param fileExists - Injected existence check for file paths. / ファイル存在確認(注入)
 * @returns Typed spec or a rejection message. / 変換結果
 */
export function parseResumeAnswer(
  reason: ResumableReason,
  answer: unknown,
  fileExists: (relPath: string) => boolean,
): ParseAnswerResult {
  switch (reason) {
    case 'retry_cap_exhausted':
    case 'pr_recovery_exhausted':
      // Only an explicit true unblocks; false means "not fixed yet".
      return answer === true
        ? { ok: true, spec: { kind: 'boolean', value: true } }
        : { ok: false, error: 'answer must be boolean true' };
    case 'verify_repair_exhausted': {
      const hit = REPAIR_STRATEGY_CHOICES.find((c) => c === answer);
      return hit
        ? { ok: true, spec: { kind: 'choice', value: hit } }
        : { ok: false, error: `answer must be one of ${REPAIR_STRATEGY_CHOICES.join(', ')}` };
    }
    case 'verify_no_convergence': {
      if (typeof answer !== 'string' || !isSafeRelativePath(answer)) {
        return { ok: false, error: 'answer must be a repository-relative path without ..' };
      }
      return fileExists(answer)
        ? { ok: true, spec: { kind: 'file_path', value: answer } }
        : { ok: false, error: 'file does not exist in the repository' };
    }
  }
}
