'use client';
/**
 * useWorkerHealthFocus
 *
 * Applies an alert deep link (`?panel=worker-health&metric=...`) once the
 * panel is on screen: pre-selects the metric and scrolls the card into view.
 * Reads window.location instead of useSearchParams so the page does not need
 * a Suspense boundary for static prerendering.
 */
import { useEffect, useState } from 'react';
import { parseWorkerHealthFocus } from '../_components/worker-health-focus';
import type { WorkerHealthMetricKey } from './useWorkerHealth';

/**
 * @param ready - True once the card is mounted and its data loaded / カードが描画可能になったか
 * @returns The selected metric and its setter / 選択中の指標とセッター
 */
export function useWorkerHealthFocus(ready: boolean): {
  selectedMetric: WorkerHealthMetricKey | null;
  setSelectedMetric: (metric: WorkerHealthMetricKey | null) => void;
} {
  const [selectedMetric, setSelectedMetric] = useState<WorkerHealthMetricKey | null>(null);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    if (!ready || applied) return;
    setApplied(true);
    const focus = parseWorkerHealthFocus(new URLSearchParams(window.location.search));
    if (!focus) return;
    if (focus.metric) setSelectedMetric(focus.metric);
    document
      .getElementById('worker-health')
      ?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [ready, applied]);

  return { selectedMetric, setSelectedMetric };
}
