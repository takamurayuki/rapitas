/**
 * calendar-hold-state
 *
 * Process-local state shared between the calendar sync poller, the auto-run
 * calendar gate and the stall detectors (task 1174): the latest busy-block
 * snapshot, which themes (selection) and tasks (phase boundary) are
 * currently held, the one-shot manual override, and the env-backed settings. Deliberately free of DB / Google imports so
 * the scheduler can read it on every tick. Not responsible for deciding a
 * hold (free-slot.ts) or for fetching (calendar-sync-service.ts).
 */
import {
  evaluateCalendarGate,
  isSyncStale,
  type BusyBlock,
  type CalendarGateResult,
} from './free-slot';

export type CalendarSyncStatus = 'never' | 'ok' | 'error';

/** Latest calendar view the gate decides from. */
export interface CalendarSnapshot {
  busyBlocks: BusyBlock[];
  lastSyncedAt: Date | null;
  lastStatus: CalendarSyncStatus;
  lastError: string | null;
  /** End of the fetched range; nothing is known beyond it. */
  horizonEnd: Date | null;
}

/** Env-backed gate settings. */
export interface CalendarSlotSettings {
  enabled: boolean;
  leadMinutes: number;
  pollMinutes: number;
}

const EMPTY_SNAPSHOT: CalendarSnapshot = {
  busyBlocks: [],
  lastSyncedAt: null,
  lastStatus: 'never',
  lastError: null,
  horizonEnd: null,
};

let snapshot: CalendarSnapshot = { ...EMPTY_SNAPSHOT };
const holds = new Map<number, Date | null>();
const taskHolds = new Map<number, Date | null>();
const pendingOverrides = new Set<number>();

function readPositiveNumber(raw: string | undefined, fallback: number, min: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

/**
 * Read the gate settings from the environment (defaults: OFF / 10 min / 5 min).
 *
 * @returns Current settings / 現在の設定
 */
export function getCalendarSlotSettings(): CalendarSlotSettings {
  return {
    enabled: process.env.RAPITAS_CALENDAR_GATE_ENABLED === 'true',
    leadMinutes: readPositiveNumber(process.env.RAPITAS_CALENDAR_LEAD_MINUTES, 10, 0),
    pollMinutes: readPositiveNumber(process.env.RAPITAS_CALENDAR_POLL_MINUTES, 5, 1),
  };
}

/** @returns The latest snapshot. / 最新スナップショット */
export function getCalendarSnapshot(): CalendarSnapshot {
  return snapshot;
}

/**
 * Merge fields into the snapshot (called by the sync service).
 *
 * @param patch - Fields to overwrite / 上書きするフィールド
 */
export function updateCalendarSnapshot(patch: Partial<CalendarSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
}

/**
 * Mark a theme as held by the calendar gate.
 *
 * @param themeId - Held theme / 保留中のテーマ
 * @param releaseAt - When the hold lifts / 解除予定時刻
 */
export function markCalendarHold(themeId: number, releaseAt: Date | null): void {
  holds.set(themeId, releaseAt);
}

/**
 * Clear a theme's hold mark.
 *
 * @param themeId - Theme / テーマ
 * @returns Whether a hold mark existed / 保留マークが存在したか
 */
export function clearCalendarHold(themeId: number): boolean {
  return holds.delete(themeId);
}

/**
 * Whether the theme is currently held by the calendar gate. A mark whose
 * release time has passed no longer counts, so a theme that stopped ticking
 * is never exempted forever.
 *
 * @param themeId - Theme / テーマ
 * @param now - Current time / 現在時刻
 * @returns true while the calendar hold is in force / 保留中なら true
 */
export function isCalendarHoldActive(themeId: number, now: Date = new Date()): boolean {
  if (!holds.has(themeId)) return false;
  const releaseAt = holds.get(themeId) ?? null;
  return releaseAt === null || now.getTime() < releaseAt.getTime();
}

/** @returns Theme ids with a hold mark and their release times. / 保留中テーマ一覧 */
export function listCalendarHolds(): Array<{ themeId: number; releaseAt: Date | null }> {
  return [...holds.entries()].map(([themeId, releaseAt]) => ({ themeId, releaseAt }));
}

/**
 * Record a one-shot manual override ("今すぐ実行") for a theme.
 *
 * @param themeId - Theme / テーマ
 */
export function requestCalendarGateOverride(themeId: number): void {
  pendingOverrides.add(themeId);
}

/**
 * Consume a pending override (deleted on read so it bypasses one cycle only).
 *
 * @param themeId - Theme / テーマ
 * @returns Whether an override was pending / オーバーライドがあったか
 */
export function consumeCalendarGateOverride(themeId: number): boolean {
  return pendingOverrides.delete(themeId);
}

/**
 * Decide the calendar hold for `now` from the current snapshot and settings.
 * `usable` is false (and the gate fails open) when the gate is off, the last
 * sync errored, or the snapshot is stale.
 *
 * @param now - Current time / 現在時刻
 * @param overridden - Whether a manual override was consumed / 手動オーバーライド消費済みか
 * @returns Usability of the snapshot and the gate decision / スナップショットの有効性と判定
 */
export function evaluateCalendarHoldNow(
  now: Date,
  overridden = false,
): { usable: boolean; gate: CalendarGateResult } {
  const settings = getCalendarSlotSettings();
  const usable =
    settings.enabled &&
    snapshot.lastStatus === 'ok' &&
    !isSyncStale(snapshot.lastSyncedAt, now, settings.pollMinutes);
  const gate = evaluateCalendarGate({
    now,
    busyBlocks: snapshot.busyBlocks,
    leadMinutes: settings.leadMinutes,
    enabled: usable,
    overridden,
  });
  return { usable, gate };
}

/**
 * Mark a running task as stopped at its phase boundary by the calendar.
 *
 * @param taskId - Held task / 保留中のタスク
 * @param releaseAt - When the hold lifts / 解除予定時刻
 */
export function markTaskCalendarHold(taskId: number, releaseAt: Date | null): void {
  taskHolds.set(taskId, releaseAt);
}

/**
 * Clear a task's phase-boundary hold mark.
 *
 * @param taskId - Task / タスク
 * @returns Whether a hold mark existed / 保留マークが存在したか
 */
export function clearTaskCalendarHold(taskId: number): boolean {
  return taskHolds.delete(taskId);
}

/**
 * Whether the task is waiting at a phase boundary for a meeting to end. Like
 * {@link isCalendarHoldActive}, an expired mark no longer counts, so a stall
 * detector can never be blinded permanently.
 *
 * @param taskId - Task / タスク
 * @param now - Current time / 現在時刻
 * @returns true while the phase-boundary hold is in force / 保留中なら true
 */
export function isTaskCalendarHeld(taskId: number, now: Date = new Date()): boolean {
  if (!taskHolds.has(taskId)) return false;
  const releaseAt = taskHolds.get(taskId) ?? null;
  return releaseAt === null || now.getTime() < releaseAt.getTime();
}

/** Reset every piece of state. Test-only — never call from production code. */
export function resetCalendarHoldState(): void {
  snapshot = { ...EMPTY_SNAPSHOT };
  holds.clear();
  taskHolds.clear();
  pendingOverrides.clear();
}
