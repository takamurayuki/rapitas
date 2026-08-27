'use client';
/**
 * use-error-diagnosis
 *
 * Fetches GET /agents/error-diagnosis (LLM-assisted diagnoses of unclassified
 * provider errors, plus summary) and exposes loading / error / data states
 * for the panel. Also exposes submitFeedback to record whether a diagnosis
 * was helpful. Not responsible for rendering — a one-shot fetch with reload.
 */
import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';

/** Suggested remediation action for a provider-communication diagnosis. */
export type DiagnosisSuggestedAction = 'retry' | 'reroute' | 'manual_intervention' | 'no_action';

/** One diagnosis row from the error-diagnosis API, with joined feedback status. */
export interface DiagnosisRecord {
  id: string;
  tsMs: number;
  taskId: number;
  phase: string;
  fromProvider: string;
  fromModel: string | null;
  rootCause: string;
  confidence: number;
  suggestedAction: DiagnosisSuggestedAction;
  reasoning: string;
  llmLatencyMs: number;
  llmModel: string;
  feedback: 'helpful' | 'not_helpful' | null;
}

/** Aggregate summary over the returned window. */
export interface DiagnosisSummary {
  total: number;
  avgConfidence: number;
  feedbackRate: number;
  helpfulRate: number;
}

/** Response shape of GET /agents/error-diagnosis. */
export interface ErrorDiagnosisResponse {
  diagnoses: DiagnosisRecord[];
  summary: DiagnosisSummary;
  windowDays: number;
  generatedAtMs: number;
}

/**
 * Load error diagnoses once on mount.
 *
 * @returns data / loading / error states, a manual reload, and a feedback submitter. / 取得状態・再取得・フィードバック送信
 */
export function useErrorDiagnosis(): {
  data: ErrorDiagnosisResponse | null;
  loading: boolean;
  error: boolean;
  reload: () => void;
  submitFeedback: (id: string, helpful: boolean) => Promise<void>;
} {
  const [data, setData] = useState<ErrorDiagnosisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const reload = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetch(`${API_BASE_URL}/agents/error-diagnosis`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as ErrorDiagnosisResponse;
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

  const submitFeedback = useCallback(
    async (id: string, helpful: boolean) => {
      const res = await fetch(`${API_BASE_URL}/agents/error-diagnosis/${id}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ helpful }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      reload();
    },
    [reload],
  );

  return { data, loading, error, reload, submitFeedback };
}
