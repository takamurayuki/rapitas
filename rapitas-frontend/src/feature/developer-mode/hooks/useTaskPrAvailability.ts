'use client';

/**
 * useTaskPrAvailability
 *
 * Probes whether a task actually HAS a pull request (synced locally, or
 * existing on GitHub but not yet synced) so completed-state UIs can hide the
 * "PRを開く" button instead of showing one that errors on click.
 */

import { useState, useEffect } from 'react';
import { API_BASE_URL } from '@/utils/api';

export type TaskPrAvailability = 'unknown' | 'available' | 'none';

/**
 * Checks PR existence for a task via the by-task lookup endpoint.
 *
 * @param taskId - Task to probe / 対象タスクID
 * @param enabled - Probe only when true (e.g. task is completed) / 有効条件
 * @returns 'available' when a PR exists (synced or not), 'none' when the
 *   backend says none was created, 'unknown' while probing. / PR有無の状態
 */
export function useTaskPrAvailability(taskId: number, enabled: boolean): TaskPrAvailability {
  const [state, setState] = useState<TaskPrAvailability>('unknown');

  useEffect(() => {
    if (!enabled) {
      setState('unknown');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/github/pull-requests/by-task/${taskId}`);
        if (res.ok) {
          if (!cancelled) setState('available');
          return;
        }
        const body = (await res.json().catch(() => null)) as {
          reason?: string;
          prUrl?: string;
        } | null;
        if (!cancelled) {
          // not_synced + URL means the PR exists on GitHub — the button still works.
          setState(body?.reason === 'not_synced' && body.prUrl ? 'available' : 'none');
        }
      } catch {
        // Probe failure (network blip) — fail open to the old always-shown
        // behavior; the click handler surfaces its own error.
        if (!cancelled) setState('available');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId, enabled]);

  return state;
}
