/**
 * useLatestTransitionCause
 *
 * Reads the cause of a task's newest WorkflowTransition — the only place the
 * reason behind a status lives (blocked causes, and the verify.md save that is
 * waiting for the diff review, task 1538). Not responsible for turning the
 * cause into a label.
 */
import { useEffect, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';

/** How often to re-read while the verify phase runs (the review can flip it). */
export const LATEST_CAUSE_POLL_MS = 10_000;

interface TransitionsResponse {
  success?: boolean;
  transitions?: Array<{ cause?: string | null }>;
}

/**
 * Fetch the newest transition cause while `enabled`, re-reading every
 * {@link LATEST_CAUSE_POLL_MS} while the workflow is `in_progress`.
 *
 * @param taskId - Task id / タスクID
 * @param opts.enabled - Fetch only while true / true の間だけ取得する
 * @param opts.status - Current workflow status / 現在のワークフロー状態
 * @returns The newest cause, or null when unknown / 最新の遷移の cause（不明なら null）
 */
export function useLatestTransitionCause(
  taskId: number,
  opts: { enabled: boolean; status: string | null | undefined },
): string | null {
  const { enabled, status } = opts;
  const [cause, setCause] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !taskId) {
      setCause(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/workflow/tasks/${taskId}/transitions`);
        if (!res.ok) return;
        const data = (await res.json()) as TransitionsResponse;
        if (cancelled || !data.success || !data.transitions?.length) return;
        setCause(data.transitions[data.transitions.length - 1]?.cause ?? null);
      } catch {
        // Non-fatal — callers fall back to their generic label.
      }
    };
    void load();
    const timer = status === 'in_progress' ? setInterval(load, LATEST_CAUSE_POLL_MS) : null;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [enabled, taskId, status]);

  return cause;
}
