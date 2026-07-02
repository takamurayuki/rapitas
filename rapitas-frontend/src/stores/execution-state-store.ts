import { create } from 'zustand';

interface ExecutingTask {
  taskId: number;
  sessionId?: number;
  status: 'running' | 'waiting_for_input' | 'completed' | 'failed';
  /** ISO timestamp the underlying AgentExecution started, for elapsed-time display. */
  startedAt?: string | null;
}

/**
 * A pending agent question surfaced to the workflow Q&A tab. Published by the
 * execution layer when the agent calls AskUserQuestion (waiting_for_input) and
 * cleared once answered/resolved. Decouples the deep agent-execution subtree
 * from the workflow viewer subtree (they share no near parent) so the live Q&A
 * can render in the Q&A tab without prop-drilling.
 */
export interface LiveQuestion {
  taskId: number;
  /** The question text (without the options block). */
  text: string;
  /** Multiple-choice options; empty when the agent asked free-text. */
  options: string[];
  /** Session to POST the answer back to (/tasks/:taskId/agent-respond). */
  sessionId?: number;
  /** ISO deadline for the auto-continue countdown, if any. */
  timeoutDeadline?: string | null;
  /** True when confirmed via the AskUserQuestion tool (not pattern-detected). */
  confirmed?: boolean;
}

interface ExecutionStateStore {
  /** List of currently executing tasks */
  executingTasks: Map<number, ExecutingTask>;
  /** Task IDs that are currently loading execution status (show skeleton) */
  loadingTaskIds: Set<number>;
  /** Add/update executing task */
  setExecutingTask: (task: ExecutingTask) => void;
  /** Remove completed tasks */
  removeExecutingTask: (taskId: number) => void;
  /** Clear all */
  clearAll: () => void;
  /** Whether specified task is executing */
  isTaskExecuting: (taskId: number) => boolean;
  /** Get execution status of specified task */
  getExecutingTaskStatus: (taskId: number) => 'running' | 'waiting_for_input' | null;
  /** Get the ISO start timestamp of a task's running execution, or null if unknown. */
  getExecutingTaskStartedAt: (taskId: number) => string | null;
  /** Mark a task as loading execution status (skeleton should be shown) */
  setTaskLoading: (taskId: number) => void;
  /** Mark a task as done loading execution status */
  setTaskLoaded: (taskId: number) => void;
  /** Whether a task is currently loading execution status */
  isTaskLoading: (taskId: number) => boolean;
  /** Pending agent questions keyed by taskId (rendered in the workflow Q&A tab). */
  liveQuestions: Map<number, LiveQuestion>;
  /** Epoch ms of the last answer per task, for the re-publish grace window. */
  answeredAt: Map<number, number>;
  /** Publish (or clear, when null) the live question for a task. */
  setLiveQuestion: (taskId: number, question: LiveQuestion | null) => void;
  /** Read the live question for a task, or null. */
  getLiveQuestion: (taskId: number) => LiveQuestion | null;
  /**
   * Mark a task's question as answered: clears it AND suppresses re-publishing
   * for a short grace window. Without this, the polling publisher re-shows the
   * same question for ~1-2s until the backend clears waiting_for_input — a
   * flicker after the user already answered.
   */
  markQuestionAnswered: (taskId: number) => void;
}

/** How long to suppress question re-publishing after an answer (ms). */
const ANSWER_GRACE_MS = 8000;

/**
 * Lazily prune stale answeredAt entries (older than ANSWER_GRACE_MS).
 * Returns the original Map if nothing was pruned (avoids unnecessary allocation).
 *
 * @param map - Current answeredAt Map / 現在のanswerAt Map
 * @param now - Current epoch ms / 現在時刻
 * @returns Pruned copy, or the original if unchanged / 変更なければ元のMapを返す
 */
function pruneAnsweredAt(map: Map<number, number>, now: number): Map<number, number> {
  let pruned = map;
  for (const [id, ts] of map) {
    if (now - ts >= ANSWER_GRACE_MS) {
      if (pruned === map) pruned = new Map(map);
      pruned.delete(id);
    }
  }
  return pruned;
}

export const useExecutionStateStore = create<ExecutionStateStore>()((set, get) => ({
  executingTasks: new Map(),
  loadingTaskIds: new Set(),
  liveQuestions: new Map(),
  answeredAt: new Map<number, number>(),
  setLiveQuestion: (taskId, question) =>
    set((state) => {
      const now = Date.now();
      // NOTE: Prune stale grace-window entries on every call so the Map cannot
      // grow unbounded during long auto-run sessions.
      const answeredAt = pruneAnsweredAt(state.answeredAt, now);

      const existing = state.liveQuestions.get(taskId) ?? null;
      // Suppress re-publishing a question within the grace window after an answer
      // (the poller keeps reporting waiting_for_input until the backend clears it).
      if (question !== null) {
        const answered = answeredAt.get(taskId);
        if (answered !== undefined && now - answered < ANSWER_GRACE_MS) {
          if (existing === null) {
            return answeredAt !== state.answeredAt ? { answeredAt } : state;
          }
          const cleared = new Map(state.liveQuestions);
          cleared.delete(taskId);
          return {
            liveQuestions: cleared,
            ...(answeredAt !== state.answeredAt ? { answeredAt } : {}),
          };
        }
      }
      // Skip no-op updates to avoid re-render loops (the publisher fires on every poll).
      if (question === null && existing === null) {
        return answeredAt !== state.answeredAt ? { answeredAt } : state;
      }
      if (
        question &&
        existing &&
        existing.text === question.text &&
        existing.options.length === question.options.length &&
        existing.options.every((o, i) => o === question.options[i]) &&
        existing.sessionId === question.sessionId &&
        existing.timeoutDeadline === question.timeoutDeadline
      ) {
        return answeredAt !== state.answeredAt ? { answeredAt } : state;
      }
      const newMap = new Map(state.liveQuestions);
      if (question === null) newMap.delete(taskId);
      else newMap.set(taskId, question);
      return {
        liveQuestions: newMap,
        ...(answeredAt !== state.answeredAt ? { answeredAt } : {}),
      };
    }),
  getLiveQuestion: (taskId) => get().liveQuestions.get(taskId) ?? null,
  markQuestionAnswered: (taskId) =>
    set((state) => {
      const answeredAt = new Map(state.answeredAt);
      answeredAt.set(taskId, Date.now());
      const liveQuestions = new Map(state.liveQuestions);
      liveQuestions.delete(taskId);
      return { answeredAt, liveQuestions };
    }),
  setTaskLoading: (taskId) =>
    set((state) => {
      if (state.loadingTaskIds.has(taskId)) return state;
      const newSet = new Set(state.loadingTaskIds);
      newSet.add(taskId);
      return { loadingTaskIds: newSet };
    }),
  setTaskLoaded: (taskId) =>
    set((state) => {
      if (!state.loadingTaskIds.has(taskId)) return state;
      const newSet = new Set(state.loadingTaskIds);
      newSet.delete(taskId);
      return { loadingTaskIds: newSet };
    }),
  isTaskLoading: (taskId) => get().loadingTaskIds.has(taskId),
  setExecutingTask: (task) =>
    set((state) => {
      const existing = state.executingTasks.get(task.taskId);
      if (
        existing &&
        existing.status === task.status &&
        existing.sessionId === task.sessionId &&
        // Normalize BOTH sides: a stored task may hold `undefined` while the
        // incoming one is normalized to null — without this the dedup never
        // short-circuits and re-clones the Map every poll.
        (existing.startedAt ?? null) === (task.startedAt ?? null)
      ) {
        return state;
      }
      const newMap = new Map(state.executingTasks);
      newMap.set(task.taskId, task);
      return { executingTasks: newMap };
    }),
  removeExecutingTask: (taskId) =>
    set((state) => {
      if (!state.executingTasks.has(taskId)) return state;
      const newMap = new Map(state.executingTasks);
      newMap.delete(taskId);
      return { executingTasks: newMap };
    }),
  clearAll: () => set({ executingTasks: new Map() }),
  isTaskExecuting: (taskId) => {
    const task = get().executingTasks.get(taskId);
    return task?.status === 'running' || task?.status === 'waiting_for_input';
  },
  getExecutingTaskStatus: (taskId) => {
    const task = get().executingTasks.get(taskId);
    if (!task) return null;
    if (task.status === 'running' || task.status === 'waiting_for_input') {
      return task.status;
    }
    return null;
  },
  getExecutingTaskStartedAt: (taskId) => get().executingTasks.get(taskId)?.startedAt ?? null,
}));
