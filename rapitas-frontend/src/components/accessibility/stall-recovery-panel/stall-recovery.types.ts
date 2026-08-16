/**
 * stall-recovery.types
 *
 * Frontend types + the open-panel event name for the accessible stall-recovery
 * UI. Mirrors the backend response types of /workflow/stall-check and
 * /workflow/tasks/:taskId/recover (kept in sync manually — the backend source
 * of truth is rapitas-backend/routes/workflow/stall-recovery).
 */

/** CustomEvent name dispatched by the Ctrl+Alt+S shortcut. */
export const OPEN_STALL_RECOVERY_EVENT = 'openStallRecovery';

/** Recovery actions offered by the backend. */
export type StallRecoveryAction = 'resume' | 'interrupt' | 'requeue' | 'clear_git_lock';

/** Actions that modify the filesystem — presented separately, never default. */
export const DESTRUCTIVE_ACTIONS: ReadonlySet<StallRecoveryAction> = new Set(['clear_git_lock']);

/** One stalled task as reported by GET /workflow/stall-check. */
export interface StalledTaskReport {
  taskId: number;
  title: string;
  staleMinutes: number;
  cause: string;
  /** Verbosity-adjusted narration text (TTS + aria-live). */
  narration: string;
  suggestedActions: StallRecoveryAction[];
}

/** Response of GET /workflow/stall-check. */
export interface StallCheckResponse {
  tasks: StalledTaskReport[];
  checkedAt: string;
}

/** Result of POST /workflow/tasks/:taskId/recover. */
export interface RecoverResult {
  success: boolean;
  action: StallRecoveryAction;
  message: string;
}

/** Panel step: 状況一覧 → アクション選択 → Space確認 → 実行結果. */
export type StallRecoveryStep = 'list' | 'actions' | 'confirm' | 'result';
