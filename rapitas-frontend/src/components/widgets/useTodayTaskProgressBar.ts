/**
 * useTodayTaskProgressBar
 *
 * Owns all derived state and celebration-effect timers for
 * TodayTaskProgressBar. Extracted from the component file to keep it under
 * the size limit; behavior is unchanged from the original inline hooks.
 */
'use client';
import { useEffect, useRef, useState } from 'react';
import { useDueTodayTasks } from '@/hooks/ui/useDueTodayTasks';
import { PROGRESS_MESSAGES } from './TodayTaskProgressBar.parts';

export interface UseTodayTaskProgressBarArgs {
  compact: boolean;
  /** Used in non-compact mode only. Compact mode self-fetches via useDueTodayTasks. */
  completedCount: number;
  /** Used in non-compact mode only. */
  totalCount: number;
  /** Used in non-compact mode only. */
  tasks?: Array<{ id: number; title: string; status: string }>;
}

/**
 * Computes the progress/effect state used by both the compact and full
 * renders of TodayTaskProgressBar.
 *
 * @param args - raw props (compact flag + non-compact fallback values) / 生の props（compact フラグと非 compact 時のフォールバック値）
 * @returns derived progress state and celebration-effect flags / 進捗の派生状態と演出フラグ
 */
export function useTodayTaskProgressBar({
  compact,
  completedCount: propCompleted,
  totalCount: propTotal,
  tasks: propTasks,
}: UseTodayTaskProgressBarArgs) {
  // Compact mode self-fetches tasks due today; non-compact uses props.
  const dueTodayResult = useDueTodayTasks();
  const completedCount = compact ? dueTodayResult.completedCount : propCompleted;
  const totalCount = compact ? dueTodayResult.totalCount : propTotal;
  const tasks = compact ? dueTodayResult.tasks : propTasks;

  const previousCompletedRef = useRef(completedCount);
  const [showEffects, setShowEffects] = useState(false);
  const [systemCritical, setSystemCritical] = useState(false);

  const progress = totalCount > 0 ? completedCount / totalCount : 0;
  const efficiency = Math.floor(progress * 100);

  useEffect(() => {
    if (completedCount > previousCompletedRef.current) {
      // Use setTimeout with 0 delay to move setState out of synchronous effect execution
      const showTimer = setTimeout(() => setShowEffects(true), 0);
      const hideTimer = setTimeout(() => setShowEffects(false), 1200);
      previousCompletedRef.current = completedCount;
      return () => {
        clearTimeout(showTimer);
        clearTimeout(hideTimer);
      };
    }
    previousCompletedRef.current = completedCount;
  }, [completedCount]);

  useEffect(() => {
    if (efficiency === 100 && totalCount > 0) {
      // Use setTimeout with 0 delay to move setState out of synchronous effect execution
      const showTimer = setTimeout(() => setSystemCritical(true), 0);
      const hideTimer = setTimeout(() => setSystemCritical(false), 4000);
      return () => {
        clearTimeout(showTimer);
        clearTimeout(hideTimer);
      };
    }
  }, [efficiency, totalCount]);

  // ── Compact-mode: celebration burst + hover popover ───────────────────────
  // wasDoneRef tracks whether we were already at 100% to detect the rising edge.
  const wasDoneRef = useRef(efficiency === 100);
  const [isCelebrating, setIsCelebrating] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    const isDoneNow = efficiency === 100 && totalCount > 0;
    if (isDoneNow && !wasDoneRef.current) {
      const t = setTimeout(() => setIsCelebrating(true), 0);
      const u = setTimeout(() => setIsCelebrating(false), 2200);
      wasDoneRef.current = true;
      return () => {
        clearTimeout(t);
        clearTimeout(u);
      };
    }
    if (!isDoneNow) wasDoneRef.current = false;
  }, [efficiency, totalCount]);

  // Pre-generate random values using useState with lazy initialization (only runs once on mount)
  const [particleData] = useState(() =>
    Array.from({ length: 8 }, () => ({
      angle: Math.random() * Math.PI * 2,
      distance: 30 + Math.random() * 50,
    })),
  );

  const [popupMsg] = useState(
    () => PROGRESS_MESSAGES[Math.floor(Math.random() * PROGRESS_MESSAGES.length)],
  );

  const [rainEffectData] = useState(() =>
    Array.from({ length: 20 }, () => ({
      x: (Math.random() - 0.5) * 800,
      text: Math.random() > 0.5 ? '1010101' : 'TASK_COMPLETE',
    })),
  );

  return {
    dueTodayResult,
    completedCount,
    totalCount,
    tasks,
    efficiency,
    showEffects,
    systemCritical,
    isCelebrating,
    isHovered,
    setIsHovered,
    particleData,
    popupMsg,
    rainEffectData,
  };
}
