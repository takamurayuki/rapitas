'use client';
/**
 * use-recovery-metrics
 *
 * Fetches GET /agents/recovery-metrics (per-(errorType × strategy) fallback
 * recovery stats) and exposes loading / error / data states for the panel.
 * Not responsible for rendering or polling — a one-shot fetch with reload.
 */
import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';

/** One aggregated (errorType × strategy) row from the metrics API. */
export interface RecoveryMetric {
  errorType: string;
  strategy: string;
  attempts: number;
  successes: number;
  failures: number;
  noCandidates: number;
  successRate: number;
  avgLatencyMs: number;
  avgCostUsd: number | null;
  failureReasons: Record<string, number>;
  lowSample: boolean;
}

/** Response shape of GET /agents/recovery-metrics. */
export interface RecoveryMetricsResponse {
  metrics: RecoveryMetric[];
  windowDays: number;
  minSamples: number;
  generatedAtMs: number;
}

/**
 * Load recovery metrics once on mount.
 *
 * @returns data / loading / error states and a manual reload. / 取得状態と再取得関数
 */
export function useRecoveryMetrics(): {
  data: RecoveryMetricsResponse | null;
  loading: boolean;
  error: boolean;
  reload: () => void;
} {
  const [data, setData] = useState<RecoveryMetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const reload = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetch(`${API_BASE_URL}/agents/recovery-metrics`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as RecoveryMetricsResponse;
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => reload(), [reload]);

  return { data, loading, error, reload };
}
