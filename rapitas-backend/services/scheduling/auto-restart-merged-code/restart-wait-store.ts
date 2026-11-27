/**
 * RestartWaitStore
 *
 * File-backed state of a "restart wait" (auto-run stops starting new work so
 * merged code can activate): when merged code first started waiting, when the
 * wait began, and which themes to bring back after the restart. A file in
 * RAPITAS_DATA_DIR because the state must outlive the very restart it prepares
 * and the schema may not change (same reasoning as settings-store.ts).
 * Not responsible for deciding when to wait — see boundary-policy.ts.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { createLogger } from '../../../config/logger';
import { homedir } from 'os';
import { dirname, join } from 'path';

// NOTE: not imported from settings-store — tests replace that module wholesale, and
// a missing export would drop their whole file. Same resolution rule.
function dataDir(): string {
  return process.env.RAPITAS_DATA_DIR?.trim() || join(homedir(), '.rapitas');
}

/**
 * How far a restart wait got. Only `waiting` and `retry` may restore themes:
 * `collecting` means the theme set was still being gathered when the process
 * died, and data without a phase predates this field — neither guarantees a
 * complete set, so neither wakes anything.
 */
export type RestartWaitPhase = 'collecting' | 'waiting' | 'retry';

/** 保留した実行と停止意図を結びつける。テーマなしはnull。 */
export interface DeferredAdvance {
  taskId: number;
  themeId: number | null;
  workflowStatus?: string;
}

const PHASES: readonly string[] = ['collecting', 'waiting', 'retry'];
const log = createLogger('restart-wait-store');

/** Persisted restart-wait state; every field is optional (absent = not set). */
export interface RestartWaitState {
  /** Epoch ms when unactivated commits were first observed. */
  aheadSinceAt?: number;
  /** Epoch ms when the wait began; present = auto-run must not start new work. */
  waitStartedAt?: number;
  /** Stage of the wait; see {@link RestartWaitPhase}. */
  phase?: RestartWaitPhase;
  /** Themes to bring back after the restart (failed ones only while `retry`). */
  resumeThemeIds?: number[];
  /**
   * Tasks whose advance was refused while the wait was in force (a direct advance has no
   * queue item to park). Replayed once when the wait ends or after the restart.
   */
  deferredAdvance?: DeferredAdvance[];
}

function stateFile(): string {
  return join(dataDir(), '.auto-restart-wait.json');
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Read the persisted state. A missing, corrupt or wrongly-typed file reads as
 * "nothing saved", so a damaged file can never hold auto-run back or wake a
 * theme nobody meant to wake.
 *
 * @returns Sanitized state (empty object when nothing valid) / 検証済みの状態
 */
export function readRestartWaitState(): RestartWaitState {
  try {
    const raw: unknown = JSON.parse(readFileSync(stateFile(), 'utf8'));
    if (typeof raw !== 'object' || raw === null) return {};
    const obj = raw as Record<string, unknown>;
    const positiveInts = (value: unknown): number[] | undefined =>
      Array.isArray(value)
        ? value.filter(
            (id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0,
          )
        : undefined;
    const ids = positiveInts(obj.resumeThemeIds);
    const deferred = Array.isArray(obj.deferredAdvance)
      ? obj.deferredAdvance.filter(
          (entry): entry is DeferredAdvance =>
            entry !== null &&
            typeof entry === 'object' &&
            Number.isInteger(entry.taskId) &&
            entry.taskId > 0 &&
            (entry.themeId === null || (Number.isInteger(entry.themeId) && entry.themeId > 0)),
        )
      : undefined;
    const state: RestartWaitState = {};
    const aheadSinceAt = positiveNumber(obj.aheadSinceAt);
    const waitStartedAt = positiveNumber(obj.waitStartedAt);
    if (aheadSinceAt !== undefined) state.aheadSinceAt = aheadSinceAt;
    if (waitStartedAt !== undefined) state.waitStartedAt = waitStartedAt;
    if (typeof obj.phase === 'string' && PHASES.includes(obj.phase)) {
      state.phase = obj.phase as RestartWaitPhase;
    }
    if (ids && ids.length > 0) state.resumeThemeIds = ids;
    if (deferred && deferred.length > 0)
      state.deferredAdvance = [...new Map(deferred.map((entry) => [entry.taskId, entry])).values()];
    return state;
  } catch {
    return {};
  }
}

/**
 * Drop a theme from the set restored after a restart. Called by stop / pause
 * before they change the theme, so a theme the user stopped is never woken by
 * the restore. Never throws: a stop must not fail because this file is bad.
 *
 * @param themeId - Theme the user stopped or paused / 停止・一時停止したテーマID
 */
export function removeThemeFromResumeSet(themeId: number): void {
  try {
    const state = readRestartWaitState();
    const rest = (state.resumeThemeIds ?? []).filter((id) => id !== themeId);
    const deferred = (state.deferredAdvance ?? []).filter((entry) => entry.themeId !== themeId);
    writeRestartWaitState({
      ...state,
      resumeThemeIds: rest.length > 0 ? rest : undefined,
      deferredAdvance: deferred.length > 0 ? deferred : undefined,
    });
  } catch {
    // Best effort by design.
  }
}

/**
 * Remember a task whose advance was refused by the wait. Only while a wait is saved
 * (`phase=waiting`): any other state has nothing that would replay it.
 *
 * @param taskId - Task whose advance was refused / 保留した advance のタスクID
 * @returns True when it is saved (or already was) / 保存できたか
 */
export function addDeferredAdvance(
  taskId: number,
  themeId: number | null,
  workflowStatus?: string,
): boolean {
  const state = readRestartWaitState();
  if (state.phase !== 'waiting') return false;
  if (state.deferredAdvance?.some((entry) => entry.taskId === taskId)) return true;
  return writeRestartWaitState({
    ...state,
    deferredAdvance: [...(state.deferredAdvance ?? []), { taskId, themeId, workflowStatus }],
  });
}

/**
 * 状態を原子的に置換する。空の状態はファイルを削除する。
 * 保存失敗はfalseで返し、呼び出し側は永続化できない待機を開始しない。
 *
 * @param state - Full state to store / 保存する状態（全体）
 */
export function writeRestartWaitState(state: RestartWaitState): boolean {
  try {
    const file = stateFile();
    if (Object.values(state).every((value) => value === undefined)) {
      rmSync(file, { force: true });
      return true;
    }
    mkdirSync(dirname(file), { recursive: true });
    // Write-then-rename: phase, flag and theme set land together or not at all.
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(state));
    renameSync(tmp, file);
    return true;
  } catch (err) {
    log.warn({ err }, '[RestartWait] 待機状態を保存できませんでした');
    return false;
  }
}
