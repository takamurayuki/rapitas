'use client';

/**
 * useParallelSSEHandler
 *
 * Processes incoming SSE events from the parallel execution stream and
 * applies them to the session state. Does not manage the EventSource lifecycle.
 */

import { useCallback } from 'react';
import type {
  ParallelSessionState,
  ParallelExecutionEvent,
} from './parallel-execution-types';

/**
 * Returns a memoized handler that merges a single SSE event into session state.
 *
 * @returns setState-compatible reducer for SSE events / セッション状態をSSEイベントで更新するコールバック
 */
export function useParallelSSEHandler() {
  const handleSSEEvent = useCallback(
    (
      event: ParallelExecutionEvent,
      setState: React.Dispatch<
        React.SetStateAction<ParallelSessionState | null>
      >,
    ) => {
      setState((prev) => {
        if (!prev) {
          // Create initial state when the first event arrives before polling
          prev = {
            sessionId: event.sessionId,
            status: 'running',
            progress: 0,
            currentLevel: 0,
            completedTasks: [],
            runningTasks: [],
            pendingTasks: [],
            failedTasks: [],
            blockedTasks: [],
            subtaskStates: new Map(),
            totalTokensUsed: 0,
            totalExecutionTimeMs: 0,
          };
        }

        const newState = { ...prev, subtaskStates: new Map(prev.subtaskStates) };

        switch (event.type) {
          case 'session_started':
            newState.status = 'running';
            break;

          case 'session_completed':
            newState.status = 'completed';
            if (event.data?.tokensUsed) {
              newState.totalTokensUsed = event.data.tokensUsed;
            }
            if (event.data?.executionTimeMs) {
              newState.totalExecutionTimeMs = event.data.executionTimeMs;
            }
            break;

          case 'session_failed':
            newState.status = 'failed';
            break;

          case 'task_started':
            if (event.taskId) {
              newState.subtaskStates.set(event.taskId, {
                taskId: event.taskId,
                status: 'running',
                startedAt: new Date(event.timestamp),
              });
              if (!newState.runningTasks.includes(event.taskId)) {
                newState.runningTasks = [
                  ...newState.runningTasks,
                  event.taskId,
                ];
              }
              newState.pendingTasks = newState.pendingTasks.filter(
                (id) => id !== event.taskId,
              );
            }
            break;

          case 'task_completed':
            if (event.taskId) {
              const existing = newState.subtaskStates.get(event.taskId);
              newState.subtaskStates.set(event.taskId, {
                ...existing,
                taskId: event.taskId,
                status: 'completed',
                completedAt: new Date(event.timestamp),
                executionTimeMs: event.data?.executionTimeMs,
                tokensUsed: event.data?.tokensUsed,
              });
              if (!newState.completedTasks.includes(event.taskId)) {
                newState.completedTasks = [
                  ...newState.completedTasks,
                  event.taskId,
                ];
              }
              newState.runningTasks = newState.runningTasks.filter(
                (id) => id !== event.taskId,
              );
            }
            break;

          case 'task_failed':
            if (event.taskId) {
              const existing = newState.subtaskStates.get(event.taskId);
              newState.subtaskStates.set(event.taskId, {
                ...existing,
                taskId: event.taskId,
                status: 'failed',
                completedAt: new Date(event.timestamp),
                error: event.data?.errorMessage,
              });
              if (!newState.failedTasks.includes(event.taskId)) {
                newState.failedTasks = [
                  ...newState.failedTasks,
                  event.taskId,
                ];
              }
              newState.runningTasks = newState.runningTasks.filter(
                (id) => id !== event.taskId,
              );
            }
            break;

          case 'level_started':
            if (event.level !== undefined) {
              newState.currentLevel = event.level;
            }
            break;

          case 'level_completed':
            break;

          case 'progress_updated':
            if (event.data) {
              if (event.data.progress !== undefined)
                newState.progress = event.data.progress;
              if (event.data.completed)
                newState.completedTasks = event.data.completed;
              if (event.data.running)
                newState.runningTasks = event.data.running;
              if (event.data.pending)
                newState.pendingTasks = event.data.pending;
              if (event.data.failed) newState.failedTasks = event.data.failed;
              if (event.data.blocked)
                newState.blockedTasks = event.data.blocked;

              event.data.completed?.forEach((id) => {
                const s = newState.subtaskStates.get(id);
                newState.subtaskStates.set(id, {
                  ...(s ?? { taskId: id }),
                  taskId: id,
                  status: 'completed',
                });
              });
              event.data.running?.forEach((id) => {
                const s = newState.subtaskStates.get(id);
                if (!s || s.status !== 'completed') {
                  newState.subtaskStates.set(id, {
                    ...(s ?? { taskId: id }),
                    taskId: id,
                    status: 'running',
                  });
                }
              });
              event.data.failed?.forEach((id) => {
                const s = newState.subtaskStates.get(id);
                newState.subtaskStates.set(id, {
                  ...(s ?? { taskId: id }),
                  taskId: id,
                  status: 'failed',
                });
              });
              event.data.blocked?.forEach((id) => {
                const s = newState.subtaskStates.get(id);
                if (
                  !s ||
                  (s.status !== 'completed' && s.status !== 'running')
                ) {
                  newState.subtaskStates.set(id, {
                    ...(s ?? { taskId: id }),
                    taskId: id,
                    status: 'blocked',
                  });
                }
              });
            }
            break;
        }

        return newState;
      });
    },
    [],
  );

  return { handleSSEEvent };
}
