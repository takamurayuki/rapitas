/**
 * phase-summary-metrics
 *
 * Computes the numeric summary shown on a collapsed phase-timeline section
 * (task #785), e.g. duration + log-line count for research/plan/implement,
 * or pass/fail test counts for verify. Returns locale-neutral numbers only —
 * per the project i18n policy, formatting the actual "✓ 1m23s (42行)" string
 * happens in the frontend fragment translator, not here.
 */

import type { PhaseIteration, PhaseRunStatus, PhaseType } from './phase-segmentation';

export interface PhaseSummary {
  status: PhaseRunStatus;
  /** Milliseconds between iteration start and completion; null while running. */
  durationMs: number | null;
  logLineCount: number;
  /** Populated only for `phaseType === 'verify'` when the log text contains a recognizable pass/fail count. */
  testPass: number | null;
  testFail: number | null;
}

const PASS_PATTERN = /(\d+)\s*(?:pass(?:ed|ing)?|success(?:es)?)/i;
const FAIL_PATTERN = /(\d+)\s*(?:fail(?:ed|ing|ures?)?)/i;

/**
 * Extracts a conservative pass/fail test count from raw verify-phase log
 * text. Deliberately regex-based (申し送り#6) — no structured test-result
 * table exists anywhere in the pipeline to read this from instead.
 *
 * @param logText - Concatenated raw log lines for a verify iteration / 検証フェーズの生ログ
 * @returns `{ pass, fail }` when at least one count is found, else null / 発見できなければ null
 */
export function extractTestStats(logText: string): { pass: number; fail: number } | null {
  const passMatch = logText.match(PASS_PATTERN);
  const failMatch = logText.match(FAIL_PATTERN);
  if (!passMatch && !failMatch) return null;
  return {
    pass: passMatch ? parseInt(passMatch[1], 10) : 0,
    fail: failMatch ? parseInt(failMatch[1], 10) : 0,
  };
}

/**
 * Builds the collapsed-section summary for one phase iteration.
 *
 * @param iteration - One {@link PhaseIteration} from `segmentPhases` / フェーズの1反復
 * @param phaseType - Which timeline phase this iteration belongs to / フェーズ種別
 * @param logText - Concatenated raw log text for this iteration, used only to extract verify pass/fail counts / 集計対象のログ本文
 * @returns Numeric summary for frontend formatting / フロント整形用の数値サマリ
 */
export function generateSummary(
  iteration: PhaseIteration,
  phaseType: PhaseType,
  logText = '',
): PhaseSummary {
  const durationMs =
    iteration.completedAt && iteration.startedAt
      ? new Date(iteration.completedAt).getTime() - new Date(iteration.startedAt).getTime()
      : null;

  const testStats = phaseType === 'verify' ? extractTestStats(logText) : null;

  return {
    status: iteration.status,
    durationMs,
    logLineCount: iteration.logLineCount,
    testPass: testStats?.pass ?? null,
    testFail: testStats?.fail ?? null,
  };
}
