'use client';
/**
 * useWorkerHealth
 *
 * Fetches the worker-health anomaly series from /agent-metrics/worker-health.
 * Kept separate from useMetricsData so the heavier 5-week aggregation never
 * delays the existing cards.
 */
import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';

export type WorkerHealthMetricKey = 'completions' | 'timeoutRate' | 'retryRate' | 'restarts';

export const WORKER_HEALTH_METRIC_ORDER: readonly WorkerHealthMetricKey[] = [
  'completions',
  'timeoutRate',
  'retryRate',
  'restarts',
];

export interface WorkerHealthPoint {
  t: string;
  raw: Record<WorkerHealthMetricKey, number | null>;
  z: Record<WorkerHealthMetricKey, number | null>;
  composite: number | null;
}

export interface WorkerHealthData {
  unit: string;
  recordingStartedAt: string | null;
  weights: Record<WorkerHealthMetricKey, number>;
  rules: { runThreshold: number; runLength: number; acfLowThreshold: number; acfMinDrop: number };
  points: WorkerHealthPoint[];
  detection: {
    run: { fired: boolean; endIndex: number };
    periodicity: { fired: boolean; recent: number | null; previous: number | null };
  };
}

export type WorkerHealthStatus = 'loading' | 'success' | 'error' | 'empty';

/**
 * Load the worker-health series once and on demand.
 *
 * @returns Data plus a status of loading | success | error | empty and a refetch trigger
 */
export function useWorkerHealth(): {
  data: WorkerHealthData | null;
  status: WorkerHealthStatus;
  refetch: () => void;
} {
  const [data, setData] = useState<WorkerHealthData | null>(null);
  const [status, setStatus] = useState<WorkerHealthStatus>('loading');
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    fetch(`${API_BASE_URL}/agent-metrics/worker-health`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as { success: boolean; data?: WorkerHealthData };
      })
      .then((v) => {
        if (cancelled) return;
        if (!v.success || !v.data) {
          setStatus('error');
          return;
        }
        setData(v.data);
        setStatus(v.data.points.length === 0 ? 'empty' : 'success');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);
  return { data, status, refetch };
}
