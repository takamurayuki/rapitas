/**
 * useTaskTerminalContext
 *
 * While the task detail view is mounted, sets the terminal working-directory
 * context to that task's directory (worktree → task dir → theme dir → repo
 * root, resolved by the backend) so Ctrl+J opens a terminal there. Clears the
 * context on unmount so other views don't inherit it.
 */
'use client';
import { useEffect } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { useTerminalContextStore } from './terminal-context-store';

/**
 * @param taskId - Current task id; skipped when not a positive number / 対象タスクID
 */
export function useTaskTerminalContext(taskId: number | null | undefined): void {
  useEffect(() => {
    if (typeof taskId !== 'number' || !Number.isFinite(taskId) || taskId <= 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/terminal-context`);
        if (!res.ok) return;
        const data = (await res.json()) as { cwd?: string; title?: string };
        if (cancelled) return;
        useTerminalContextStore.getState().setTerminalContext({
          cwd: data.cwd ?? null,
          title: data.title ?? null,
        });
      } catch {
        // Leave context unchanged on failure.
      }
    })();
    return () => {
      cancelled = true;
      useTerminalContextStore.getState().setTerminalContext({ cwd: null });
    };
  }, [taskId]);
}
