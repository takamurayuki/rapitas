/**
 * use-decision-timer
 *
 * Manual start/finish timer for one triage item plus the per-kind estimate.
 * Not responsible for rendering (see DecisionTimerPanel) or for the triage queue.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDecisionDurationStore } from '@/stores/decision-duration-store';
import { toDisplayMinutes, trimmedMedianMs } from '../_lib/decision-duration-stats';

interface Options {
  itemId: number;
  kind: string;
}

/**
 * Track how long the current decision takes and expose the typical duration for its kind.
 *
 * @param options - Current item id and decision kind / 現在の項目IDと判断種別
 * @returns Timer controls, running state, elapsed ms and estimate in minutes (null when too few samples) / 計測操作と目安(分)
 */
export function useDecisionTimer({ itemId, kind }: Options) {
  const record = useDecisionDurationStore((s) => s.record);
  const samples = useDecisionDurationStore((s) => s.durations[kind]);
  const startedRef = useRef<{ at: number; kind: string } | null>(null);
  const prevItemRef = useRef(itemId);
  const [running, setRunning] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);

  const stop = useCallback(
    (save: boolean) => {
      const s = startedRef.current;
      startedRef.current = null;
      setRunning(false);
      setElapsedMs(0);
      if (save && s) record(s.kind, Date.now() - s.at);
    },
    [record],
  );

  // A key-driven approve/reject changes the current item, which is the decision finishing:
  // save once under the kind captured at start (not the new item's kind).
  useEffect(() => {
    if (prevItemRef.current === itemId) return;
    prevItemRef.current = itemId;
    if (startedRef.current) stop(true);
  }, [itemId, stop]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      if (startedRef.current) setElapsedMs(Date.now() - startedRef.current.at);
    }, 1000);
    return () => clearInterval(timer);
  }, [running]);

  const start = useCallback(() => {
    startedRef.current = { at: Date.now(), kind };
    setElapsedMs(0);
    setRunning(true);
  }, [kind]);
  const finish = useCallback(() => stop(true), [stop]);
  const discard = useCallback(() => stop(false), [stop]);

  const median = trimmedMedianMs(samples ?? []);
  return {
    running,
    elapsedMs,
    sampleCount: samples?.length ?? 0,
    estimateMinutes: median === null ? null : toDisplayMinutes(median),
    start,
    finish,
    discard,
  };
}
