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
import {
  PAUSED_AUTO_RUN_STATUSES,
  isAutoResumablePauseStatus,
} from './auto-run/theme-auto-run-types';

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
 * Resolves which candidate themes are paused in a way that nothing will ever
 * auto-resume (task #1220): `paused_user` (operator pause) and the legacy
 * reason-unknown `paused`. `pauseAutoRun` leaves `enabled` untouched, so such a
 * theme never lands in `resolveDisabledAutoRunThemeIds`, yet it dispatches
 * nothing — its non-terminal tasks are an intentional indefinite wait, not
 * stagnation. `paused_approval` is deliberately excluded: it is auto-resumed
 * once the plan is approved, so a stall there is a real signal. The status set
 * is derived from `isAutoResumablePauseStatus` so it cannot drift from the
 * resume path. Query failure resolves to an empty set (fail-open — detection
 * keeps working and one failed lookup cannot take the whole pass down).
 *
 * @param themeIds - Distinct, non-null theme ids among this pass's candidates. / 候補のテーマID一覧
 * @returns Set of theme ids paused without automatic resume. / 自動再開されない一時停止中のテーマID集合
 */
export async function resolvePausedUserThemeIds(themeIds: number[]): Promise<Set<number>> {
  if (themeIds.length === 0) return new Set();
  const statuses = PAUSED_AUTO_RUN_STATUSES.filter((s) => !isAutoResumablePauseStatus(s));
  const paused = await prisma.themeAutoRun
    .findMany({
      where: { themeId: { in: themeIds }, status: { in: [...statuses] } },
      select: { themeId: true },
    })
    .catch(() => [] as { themeId: number }[]);
  return new Set(paused.map((p) => p.themeId));
}

/**
 * Resolves which candidate themes are "armed" for the blocked-task
 * retry/escalation pipeline — `ThemeAutoRun.enabled === true && status ===
 * 'running'` (task 977). Condition-for-condition identical to
 * `workflow-reconciler-blocked.ts`'s `findBlockedCandidates` armed query — a
 * drift here would silence stagnation detection for `blocked` tasks that
 * pipeline does NOT actually retry/escalate (e.g. a paused theme), causing a
 * new silent-permanent-stall regression instead of fixing one. Query failure
 * resolves to an empty set (fail-open — detectStagnation keeps detecting).
 *
 * @param themeIds - Distinct, non-null theme ids among this pass's candidates. / 候補のテーマID一覧
 * @returns Set of theme ids whose blocked-task pipeline is armed. / blockedタスク自動再試行パイプラインが有効なテーマID集合
 */
export async function resolveArmedThemeIds(themeIds: number[]): Promise<Set<number>> {
  if (themeIds.length === 0) return new Set();
  const armed = await prisma.themeAutoRun
    .findMany({
      where: { themeId: { in: themeIds }, enabled: true, status: 'running' },
      select: { themeId: true },
    })
    .catch(() => [] as { themeId: number }[]);
  return new Set(armed.map((a) => a.themeId));
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
