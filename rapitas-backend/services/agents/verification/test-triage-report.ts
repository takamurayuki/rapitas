/**
 * test-triage-report
 *
 * Maps a `triageTestFailures` outcome (a classification, or null when the
 * baseline comparison was indeterminate) onto the `test` VerificationCheck.
 * Extracted from automated-verifier.ts's testProject (file-size split) so the
 * null branch is a pure, directly testable function. Not responsible for
 * running tests or the triage itself.
 */
import type { VerificationCheck } from './automated-verifier';

export interface TriagedTestCheckInput {
  /** Triage classification, or null when the baseline comparison was indeterminate. */
  triage: { preExisting: string[]; newFailures: string[] } | null;
  /** Test files that were in scope for the triage (project-relative). */
  scopedFiles: string[];
  /** Raw per-command failure output from the scoped test run. */
  rawFailures: string[];
  /** Number of scoped test commands that were executed. */
  commandCount: number;
  /** Cap on the `details` field length. */
  maxDetailChars: number;
}

/**
 * Builds the `test` check from a triage outcome. A null triage is
 * INDETERMINATE, not "all new": the gate stays open (ok:true, errorCount:0)
 * and the unattributed files are surfaced via `indeterminateFailures` so the
 * caller can file a concern instead of blocking the task (task 659). A genuine
 * classification keeps the existing behaviour — only `newFailures` count.
 *
 * @param input - Triage outcome plus the raw run evidence / トリアージ結果と生の実行証跡
 * @returns The `test` verification check / test チェック結果
 */
export function buildTriagedTestCheck(input: TriagedTestCheckInput): VerificationCheck {
  const { triage, scopedFiles, rawFailures, commandCount, maxDetailChars } = input;
  const rawDetail = rawFailures.join('\n\n');
  if (triage === null) {
    return {
      name: 'test',
      ran: true,
      ok: true,
      errorCount: 0,
      details: [
        `${commandCount} test command(s) failed, but the baseline comparison was indeterminate`,
        '(merge-base / baseline worktree unavailable after retries), so the failures could not be',
        'attributed to this change. Skipped as a hard gate; reported to the concern backlog.',
        `Unattributed scoped test files: ${scopedFiles.join(', ')}`,
        '',
        rawDetail,
      ]
        .join('\n')
        .slice(0, maxDetailChars),
      indeterminate: true,
      indeterminateFailures: scopedFiles,
    };
  }
  const { preExisting, newFailures } = triage;
  const newOk = newFailures.length === 0;
  return {
    name: 'test',
    ran: true,
    ok: newOk,
    errorCount: newFailures.length,
    details: newOk
      ? `${commandCount} test command(s): passed (${preExisting.length} pre-existing failure(s) excluded)`
      : rawDetail.slice(0, maxDetailChars),
    preExistingFailures: preExisting.length > 0 ? preExisting : undefined,
  };
}
