/**
 * rapi-avatar-state
 *
 * What the avatar should be showing, worked out from the workflow phases the
 * backend broadcasts over SSE plus the live execution count.
 *
 * Pure: no subscriptions, no clock of its own. `useRapiAvatarState` collects
 * the signals and this decides what they mean, so the rules — the priority
 * order and the two timed states — can be tested without a server.
 *
 * The phase names are rapitas's `workflowStatus` values, which is what
 * `phase_transition` actually carries (see workflow-runner-events.ts). The
 * avatar spec describes them by agent role; this is the same ladder.
 */
import type { RapiAvatarState } from './RapiAvatar';

/** Planning the work: researcher and planner. */
const THINKING_PHASES = new Set(['draft', 'research_done']);
/** Doing the work: implementer and verifier. */
const RUNNING_PHASES = new Set(['plan_approved', 'in_progress']);
/** Stopped for a person: an approval or an answer. */
const WAITING_PHASES = new Set(['plan_created', 'awaiting_question']);
/** The task is off the board. */
const TERMINAL_PHASES = new Set(['completed', 'verify_done']);

/**
 * How long a finish stays on screen before the avatar settles.
 * The spec asks for 3–5 seconds.
 */
export const DONE_HOLD_MS = 4_000;

/**
 * How long a failure stays on screen.
 *
 * It expires, unlike a wait. A wait is a job for the user and holds until
 * they do it; a block is news. This machine carries chronically blocked
 * tasks — eight of them the day this was written — so a lasting error would
 * leave the avatar permanently red and saying nothing.
 */
export const ERROR_HOLD_MS = 8_000;

/** Most comets the ring can carry before they smear into a line. */
const MAX_COMETS = 4;

/** The latest phase seen for each task that is still in flight. */
export type TaskPhases = Record<number, string>;

/** Everything the avatar's state is derived from. */
export interface AvatarSignals {
  phases: TaskPhases;
  /** When a task last blocked, or null. / 直近のブロック時刻 */
  errorAt: number | null;
  /** When a task last finished, or null. / 直近の完了時刻 */
  doneAt: number | null;
  /** Executions running right now, from `/health`. / 実行中の数 */
  activeExecutions: number;
}

/** The avatar's state, and how many comets to draw. */
export interface ResolvedAvatar {
  state: RapiAvatarState;
  agents: number;
}

/**
 * Fold one phase transition into the set of tasks in flight.
 *
 * @param phases - What each task was last seen doing / 現在の把握
 * @param taskId - The task that moved / 遷移したタスク
 * @param phase - Where it moved to / 遷移先フェーズ
 * @returns The updated set / 更新後の把握
 */
export function applyPhase(phases: TaskPhases, taskId: number, phase: string): TaskPhases {
  // The runner emits `previousPhase → advancing` on every poll tick, so
  // acting on it would make the avatar flicker at the poll rate.
  if (phase === 'advancing') return phases;

  // A task that finished or blocked leaves the board. Blocking is reported
  // through `errorAt` instead, which expires; keeping it here would pin the
  // avatar to that task for as long as it stayed blocked.
  if (TERMINAL_PHASES.has(phase) || phase === 'blocked') {
    if (!(taskId in phases)) return phases;
    const next = { ...phases };
    delete next[taskId];
    return next;
  }

  return { ...phases, [taskId]: phase };
}

/** Whether any task in flight is in one of `set`. */
function anyPhaseIn(phases: TaskPhases, set: Set<string>): boolean {
  return Object.values(phases).some((phase) => set.has(phase));
}

/**
 * Decide what the avatar shows.
 *
 * Priority is error > waiting > running > thinking > done > idle: whatever
 * needs the user first, then whatever is happening, then the pleasantries.
 *
 * @param signals - The collected signals / 収集した状態
 * @param now - Current time in ms, for the timed states / 現在時刻(ms)
 * @returns The state and the comet count / 表示状態と彗星の数
 */
export function resolveAvatarState(signals: AvatarSignals, now: number): ResolvedAvatar {
  const { phases, errorAt, doneAt, activeExecutions } = signals;

  const running = anyPhaseIn(phases, RUNNING_PHASES) || activeExecutions > 0;
  const agents = running ? Math.min(MAX_COMETS, Math.max(1, Math.round(activeExecutions))) : 1;

  if (errorAt !== null && now - errorAt < ERROR_HOLD_MS) return { state: 'error', agents };
  if (anyPhaseIn(phases, WAITING_PHASES)) return { state: 'waiting', agents };
  if (running) return { state: 'running', agents };
  if (anyPhaseIn(phases, THINKING_PHASES)) return { state: 'thinking', agents };
  if (doneAt !== null && now - doneAt < DONE_HOLD_MS) return { state: 'done', agents };
  return { state: 'idle', agents };
}
