/**
 * verify-repair-pollution
 *
 * Keeps a log-polluted verify.md out of its own repair feedback, so a corrupt
 * report cannot make self-repair unwinnable.
 * Not responsible for detecting pollution (phase-output-validator owns that) or
 * for writing the file — callers do both.
 */

import { looksLogPolluted } from './phase-output-validator';

/**
 * Replaces a discarded body. A bare empty file would read as "verify.md was
 * never written"; the implementer needs to know the previous content existed
 * and why it is gone, or it may assume the save failed and repeat it.
 */
export const POLLUTED_BASE_NOTE = [
  '# 検証レポート',
  '',
  '> 直前の verify.md はエージェントの実行ログ／ストリーム出力が混入していたため破棄しました。',
  '> 本文を一から書き直してください（ログの貼り付けは不可）。',
].join('\n');

/** What the repair-feedback writer may use from the rejected round. */
export interface RepairFeedbackSources {
  /** Body to build on: the prior report, or a note when it was discarded. */
  base: string;
  /** Content the block may quote excerpts from, or undefined when unusable. */
  quoted: string | undefined;
}

/**
 * Decide what a repair round may carry forward from the rejected one.
 *
 * NOTE: Both halves matter, and neither alone is enough. `writeRepairFeedback`
 * writes `prior + feedback`, so a corrupt `prior` is re-saved and fails the
 * identical check next round; and `buildRepairFeedbackBlock` quotes excerpts
 * from the rejected content, so a corrupt file would smuggle its agent-log
 * lines back in through the block even after the body was dropped.
 *
 * Measured 2026-10-11 on task 1160: six archived versions, all tripping the
 * same three HARD patterns including `Process has been unresponsive for` — the
 * 301-second kill notice. The body never changed across retries (5783 → 6417
 * bytes, the growth being the attempt counter alone), so five bounces asked the
 * agent to fix a file it was handed still broken, then the budget halted it.
 *
 * Judged independently because the stored file and the content handed in can
 * differ: a clean report on disk with a corrupt rejection, or the reverse.
 *
 * @param prior - Current verify.md body / 現在の verify.md 本文
 * @param rejected - The content the validator rejected / 却下された内容
 * @returns The body to build on and the content safe to quote / 土台と引用可能な内容
 */
export function repairFeedbackSources(
  prior: string,
  rejected: string | undefined,
): RepairFeedbackSources {
  return {
    base: looksLogPolluted(prior) ? POLLUTED_BASE_NOTE : prior,
    quoted: rejected && looksLogPolluted(rejected) ? undefined : rejected,
  };
}
