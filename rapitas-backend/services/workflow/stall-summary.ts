/**
 * stall-summary
 *
 * Voice-oriented short summaries for stalled tasks: infers a probable cause
 * from a gathered task snapshot and renders a narration string in three
 * verbosity levels. Pure inference/formatting only — no DB access, no TTS,
 * no detection (detection lives in incident-signature-detectors).
 */
import type { GatheredTaskState } from './self-incident-evidence';

/** Narration detail level requested by the client's voice settings. */
export type StallVerbosity = 'concise' | 'standard' | 'detailed';

/**
 * Recovery actions the stall-recovery UI can offer. `clear_git_lock` is the
 * only destructive one — it is always listed last and its execution is gated
 * separately (env flag + worktree path guard in stall-recovery-service).
 */
export type StallRecoveryAction = 'resume' | 'interrupt' | 'requeue' | 'clear_git_lock';

/** Session statuses that claim an agent is (or is about to be) working. */
const IN_FLIGHT_SESSION_STATUSES = new Set(['active', 'running', 'pending']);

/** Titles longer than this are truncated in narration — TTS reads every char. */
const NARRATION_TITLE_MAX = 40;

/** Inferred probable cause + the recovery actions that make sense for it. */
export interface StallCauseResult {
  /** One-sentence probable cause (Japanese, TTS-readable). */
  cause: string;
  /** Non-destructive actions first; `clear_git_lock` is always appended last. */
  suggestedActions: StallRecoveryAction[];
}

/**
 * Truncates a task title for narration so TTS output stays short.
 *
 * @param title - Raw task title. / 元のタスク名
 * @returns Title capped at 40 chars with ellipsis. / 40字で省略したタスク名
 */
export function truncateTitleForNarration(title: string): string {
  if (title.length <= NARRATION_TITLE_MAX) return title;
  return `${title.slice(0, NARRATION_TITLE_MAX)}…`;
}

/**
 * Infers the most probable stall cause from a gathered snapshot. Heuristic
 * priority: interrupted work > failed work > session/execution contradiction >
 * approval wait > never started > unknown. Each cause maps to the recovery
 * actions that can actually address it.
 *
 * @param state - Gathered snapshot (self-incident-evidence). / 収集済みスナップショット
 * @param workflowStatus - Task's workflowStatus (null = none). / ワークフロー状態
 * @returns Probable cause + suggested actions. / 推測原因と推奨アクション
 */
export function inferStallCause(
  state: GatheredTaskState,
  workflowStatus: string | null,
): StallCauseResult {
  let cause: string;
  let actions: StallRecoveryAction[];

  if (
    state.latestExecutionStatus === 'interrupted' ||
    state.latestSessionStatus === 'interrupted'
  ) {
    cause = 'エージェント実行が中断されたまま再開されていない可能性があります';
    actions = ['resume', 'requeue'];
  } else if (state.latestExecutionStatus === 'failed' || state.latestSessionStatus === 'failed') {
    cause = '直近のエージェント実行が失敗したまま後続処理が動いていない可能性があります';
    actions = ['requeue'];
  } else if (
    state.latestSessionStatus !== null &&
    IN_FLIGHT_SESSION_STATUSES.has(state.latestSessionStatus) &&
    !state.hasLiveExecution
  ) {
    cause = 'セッションが進行中扱いのまま、実際に動いている実行が存在しない状態です';
    actions = ['interrupt', 'requeue'];
  } else if (workflowStatus === 'plan_created') {
    cause = '実装計画が承認待ちのまま停止している可能性があります';
    actions = ['requeue'];
  } else if (state.latestSessionId === null && !state.hasAnyExecution) {
    cause = 'ワークフローは開始済みですが、エージェントの起動記録がありません';
    actions = ['requeue'];
  } else {
    cause = '明確な原因を特定できません。活動記録が閾値を超えて途絶しています';
    actions = ['requeue'];
  }

  // The destructive option is always PRESENTED (task requirement: manual
  // choice), never auto-selected; execution is double-gated in the service.
  actions.push('clear_git_lock');
  return { cause, suggestedActions: actions };
}

/**
 * Renders one stalled task into a narration string for TTS + aria-live.
 *
 * @param args.state - Gathered snapshot. / 収集済みスナップショット
 * @param args.staleMs - Staleness from detectStagnation. / 停滞継続ミリ秒
 * @param args.cause - Inferred cause sentence. / 推測原因
 * @param args.verbosity - Detail level. / 詳細度
 * @returns Narration text. / 読み上げ用テキスト
 */
export function summarizeStall(args: {
  state: GatheredTaskState;
  staleMs: number;
  cause: string;
  verbosity: StallVerbosity;
}): string {
  const { state, staleMs, cause, verbosity } = args;
  const title = truncateTitleForNarration(state.title);
  const staleMinutes = Math.max(1, Math.round(staleMs / 60_000));
  const base = `タスク「${title}」が${staleMinutes}分間停滞しています。`;

  if (verbosity === 'concise') return base;

  const withCause = `${base}${cause}。`;
  if (verbosity === 'standard') return withCause;

  const detailParts: string[] = [
    `最新セッション状態は${state.latestSessionStatus ?? 'なし'}、` +
      `最新実行状態は${state.latestExecutionStatus ?? 'なし'}です。`,
    `実行中エージェントは${state.hasLiveExecution ? 'あり' : 'なし'}、` +
      `待機中のキュー項目は${state.hasActiveQueueItem ? 'あり' : 'なし'}です。`,
  ];
  const lastTransition = state.timeline[state.timeline.length - 1];
  if (lastTransition) {
    detailParts.push(
      `最後の状態遷移は${lastTransition.toStatus}へ、原因は${lastTransition.cause}でした。`,
    );
  }
  return `${withCause}${detailParts.join('')}`;
}
