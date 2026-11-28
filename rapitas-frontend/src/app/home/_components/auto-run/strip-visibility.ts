/**
 * strip-visibility
 *
 * When the auto-run progress strip is drawn. Shared by the toolbar (which
 * mounts it) and the strip itself, so the two cannot disagree.
 */
import type { AutoRunStatus } from '@/hooks/workflow/useThemeAutoRun';

/**
 * The strip shows while auto-run is on, and also while it is off as long as
 * tasks still wait for CI — otherwise nothing on screen would say so.
 *
 * @param data - Auto-run status and the CI-wait list, or null / 状態とCI待ち一覧
 * @returns True when the strip should be drawn / 帯を出すなら true
 */
export function isProgressStripVisible(
  data: { autoRun: { status: AutoRunStatus }; awaitingCi?: readonly unknown[] } | null,
): boolean {
  if (!data) return false;
  const { status } = data.autoRun;
  return status === 'running' || status === 'paused' || (data.awaitingCi?.length ?? 0) > 0;
}
