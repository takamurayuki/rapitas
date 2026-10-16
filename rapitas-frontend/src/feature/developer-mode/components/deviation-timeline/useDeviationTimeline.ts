'use client';

/**
 * useDeviationTimeline
 *
 * Loads the plan-deviation timeline for a task (task #1218), fetches the log
 * lines around a selected deviation, and submits the reviewer's decision as
 * an audit record. Prevents double submission while a decision is in flight.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';
import type {
  DeviationContextLine,
  DeviationDecision,
  DeviationTimelineResponse,
} from './deviation-timeline.types';

/** Lines requested before and after the deviation's log line. */
export const DEVIATION_CONTEXT_LINES = 5;

export interface UseDeviationTimelineResult {
  timeline: DeviationTimelineResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  fetchContext: (executionId: number, seq: number) => Promise<DeviationContextLine[]>;
  submitAudit: (decision: DeviationDecision, comment: string) => Promise<boolean>;
  submitting: boolean;
  submitError: string | null;
}

/**
 * @param taskId - Task whose deviation timeline to load / タスクID
 * @returns Timeline state plus context / audit actions / タイムライン状態と操作
 */
export function useDeviationTimeline(taskId: number): UseDeviationTimelineResult {
  const [timeline, setTimeline] = useState<DeviationTimelineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Ref, not state: the double-submit guard must see the in-flight flag
  // synchronously, before React re-renders.
  const submittingRef = useRef(false);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/workflow/tasks/${taskId}/deviation-timeline`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as Partial<DeviationTimelineResponse>;
      // An older backend without the route answers with some other JSON shape.
      if (typeof body.status !== 'string') throw new Error('invalid deviation timeline response');
      setTimeline({
        ...body,
        entries: body.entries ?? [],
        warnings: body.warnings ?? [],
      } as DeviationTimelineResponse);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const fetchContext = useCallback(async (executionId: number, seq: number) => {
    const qs = `seq=${seq}&before=${DEVIATION_CONTEXT_LINES}&after=${DEVIATION_CONTEXT_LINES}`;
    const res = await fetch(
      `${API_BASE_URL}/workflow/executions/${executionId}/deviation-context?${qs}`,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { lines?: DeviationContextLine[] };
    return body.lines ?? [];
  }, []);

  const submitAudit = useCallback(
    async (decision: DeviationDecision, comment: string) => {
      if (submittingRef.current) return false;
      submittingRef.current = true;
      setSubmitting(true);
      setSubmitError(null);
      try {
        const res = await fetch(`${API_BASE_URL}/workflow/tasks/${taskId}/deviation-audit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Rapitas-Source': 'ui' },
          body: JSON.stringify({
            decision,
            comment,
            ...(timeline?.executionId ? { executionId: timeline.executionId } : {}),
          }),
        });
        const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
        if (!res.ok || body.success !== true) {
          setSubmitError(body.error ?? `HTTP ${res.status}`);
          return false;
        }
        return true;
      } catch (e) {
        setSubmitError(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
      }
    },
    [taskId, timeline?.executionId],
  );

  return {
    timeline,
    loading,
    error,
    refetch,
    fetchContext,
    submitAudit,
    submitting,
    submitError,
  };
}
