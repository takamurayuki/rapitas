/**
 * phase-timeline/format-phase-summary
 *
 * Formats the numeric PhaseIterationSummary from the backend into the
 * collapsed-section 1-line text (task #785), e.g. "✓ 1m23s (42行)" or
 * "24 pass / 0 fail" for verify. Pure — no i18n side effects beyond calling
 * the passed translator.
 */

import type { PhaseIterationSummary } from '../../hooks/usePhaseTimeline';
import type { PhaseType } from '../../utils/phase-selector';

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * @param ms - Duration in milliseconds / 所要時間(ミリ秒)
 * @returns Compact "1m23s" / "45s" style string / 短縮表記
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m${seconds}s` : `${seconds}s`;
}

/**
 * @param summary - Numeric summary from usePhaseTimeline / 数値サマリ
 * @param phaseType - Which phase this iteration belongs to (only 'verify' gets pass/fail formatting) / フェーズ種別
 * @param t - Translator scoped to the `phaseTimeline` namespace / 名前空間 phaseTimeline の翻訳関数
 * @returns The collapsed-state 1-line summary, or null while running with no lines yet / 折りたたみ時の要約、まだ無ければ null
 */
export function formatPhaseSummary(
  summary: PhaseIterationSummary,
  phaseType: PhaseType,
  t: Translate,
): string | null {
  if (summary.status === 'running') {
    return summary.logLineCount === 0 ? t('summary.runningEmpty') : null;
  }
  if (phaseType === 'verify' && summary.testPass !== null) {
    return t('summary.verifyPassFail', { pass: summary.testPass, fail: summary.testFail ?? 0 });
  }
  const duration = summary.durationMs !== null ? formatDuration(summary.durationMs) : '';
  const key = summary.status === 'failed' ? 'summary.failed' : 'summary.completed';
  return t(key, { duration, lines: summary.logLineCount });
}
