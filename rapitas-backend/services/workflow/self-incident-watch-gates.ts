/**
 * self-incident-watch-gates
 *
 * Batch-resolves per-pass gating signals for self-incident-watcher's
 * detectors: themes with auto-run explicitly disabled, themes that are not
 * development themes (auto-run is structurally impossible there), and
 * whether the multi-phase workflow is disabled globally. Split out of
 * self-incident-watcher.ts (task #860) to keep that file under the
 * COMPONENT_SPLITTING_POLICY.md line limit. Not responsible for detection
 * logic itself — see incident-signature-detectors.ts.
 */
import { prisma } from '../../config/database';

/**
 * Resolves each candidate's theme auto-run enabled state in one batch query
 * (task #715) — avoids an N+1 `ThemeAutoRun` lookup per candidate. Only
 * themes with an explicit `enabled: false` row are recorded; every other
 * themeId (no row, enabled: true, or unthemed) is absent from the map, and
 * detectTriStateDesync treats a missing entry as "enabled" (fail open — see
 * TriStateDesyncInput.themeAutoRunEnabled).
 *
 * @param themeIds - Distinct, non-null theme ids among this pass's candidates. / 候補のテーマID一覧
 * @returns Set of theme ids whose auto-run is explicitly disabled. / 自動実行が無効なテーマID集合
 */
export async function resolveDisabledAutoRunThemeIds(themeIds: number[]): Promise<Set<number>> {
  if (themeIds.length === 0) return new Set();
  const disabled = await prisma.themeAutoRun
    .findMany({
      where: { themeId: { in: themeIds }, enabled: false },
      select: { themeId: true },
    })
    .catch(() => [] as { themeId: number }[]);
  return new Set(disabled.map((d) => d.themeId));
}

/**
 * Resolves which candidate themes are NOT development themes
 * (`Theme.isDevelopment === false`) in one batch query (task #860). Auto-run
 * is structurally impossible for a non-development theme —
 * `routes/workflow/theme-auto-run.ts` refuses to enable `ThemeAutoRun` for
 * one — so a task there can never gain a live execution or queue item, and
 * detectStagnation's "stuck" signal is a false positive (task #811,
 * themeId=28, `isDevelopment=false`). Only themes with an explicit
 * `isDevelopment: false` row are recorded; a missing row (query failure, or
 * the theme having been deleted) leaves it absent from the result and
 * detectStagnation keeps treating the task as workflow-managed (fail-open).
 *
 * @param themeIds - Distinct, non-null theme ids among this pass's candidates. / 候補のテーマID一覧
 * @returns Set of theme ids that are not development themes. / 非開発テーマのID集合
 */
export async function resolveNonDevelopmentThemeIds(themeIds: number[]): Promise<Set<number>> {
  if (themeIds.length === 0) return new Set();
  const rows = await prisma.theme
    .findMany({
      where: { id: { in: themeIds }, isDevelopment: false },
      select: { id: true },
    })
    .catch(() => [] as { id: number }[]);
  return new Set(rows.map((r) => r.id));
}

/**
 * Resolves each candidate's theme auto-run RUN state in one batch query
 * (task #969) — only rows with `status === 'running'` are fetched, so a
 * present entry always means "actively dispatching". Feeds the stagnation /
 * Pattern B gate that treats a task waiting behind another task on a busy
 * theme as a normal backlog wait, not stagnation (AUTO_RUN_GLOBAL_MAX_
 * CONCURRENCY defaults to 1, so this routinely exceeds STAGNATION_THRESHOLD_MS).
 * A missing themeId (idle/paused/stopping, no row, or a query failure) is
 * absent from the map — callers must treat that as "not busy" (fail-open).
 *
 * @param themeIds - Distinct, non-null theme ids among this pass's candidates. / 候補のテーマID一覧
 * @returns Map of themeId to its running currentTaskId. / 稼働中テーマIDと現在処理中タスクIDの対応
 */
export async function resolveThemeAutoRunRunState(
  themeIds: number[],
): Promise<Map<number, { currentTaskId: number | null }>> {
  if (themeIds.length === 0) return new Map();
  const rows = await prisma.themeAutoRun
    .findMany({
      where: { themeId: { in: themeIds }, status: 'running' },
      select: { themeId: true, currentTaskId: true },
    })
    .catch(() => [] as { themeId: number; currentTaskId: number | null }[]);
  return new Map(rows.map((r) => [r.themeId, { currentTaskId: r.currentTaskId }]));
}

/**
 * Resolves whether the multi-phase workflow is disabled globally
 * (`UserSettings.workflowDisabledGlobally`), mirroring
 * workflow-disabled.ts's `resolveEffectiveWorkflowDisabled` fail-open
 * contract — a settings-lookup failure resolves to `false` (not disabled),
 * never widening the gate on missing data.
 *
 * @returns True when the global flag is set. / グローバルにワークフローが無効化されているか
 */
export async function resolveWorkflowDisabledGlobally(): Promise<boolean> {
  const row = (await prisma.userSettings.findFirst().catch(() => null)) as {
    workflowDisabledGlobally?: boolean | null;
  } | null;
  return !!row?.workflowDisabledGlobally;
}
