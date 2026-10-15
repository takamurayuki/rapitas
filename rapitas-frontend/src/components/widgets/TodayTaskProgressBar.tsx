/**
 * TodayTaskProgressBar
 *
 * Renders the "tasks due today" progress indicator, either as a compact
 * thermometer bar (dashboard/toolbar use) or a full "DAILY PROTOCOL" card
 * with celebration effects. This file only orchestrates: derived state lives
 * in useTodayTaskProgressBar, and each mode's markup lives in
 * TodayTaskProgressBar.compact.tsx / TodayTaskProgressBar.full.tsx.
 */
'use client';
import { memo } from 'react';
import { useTodayTaskProgressBar } from './useTodayTaskProgressBar';
import TodayTaskProgressBarCompact from './TodayTaskProgressBar.compact';
import TodayTaskProgressBarFull from './TodayTaskProgressBar.full';

interface TodayTaskProgressBarProps {
  /** Used in non-compact mode only. Compact mode self-fetches via useDueTodayTasks. */
  completedCount?: number;
  /** Used in non-compact mode only. */
  totalCount?: number;
  className?: string;
  compact?: boolean;
  /** Used in non-compact mode only. */
  tasks?: Array<{ id: number; title: string; status: string }>;
}

const TodayTaskProgressBar = memo<TodayTaskProgressBarProps>(
  ({
    completedCount: propCompleted = 0,
    totalCount: propTotal = 0,
    className = '',
    compact = false,
    tasks: propTasks,
  }) => {
    const {
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
    } = useTodayTaskProgressBar({
      compact,
      completedCount: propCompleted,
      totalCount: propTotal,
      tasks: propTasks,
    });

    if (compact) {
      return (
        <TodayTaskProgressBarCompact
          className={className}
          isLoading={dueTodayResult.isLoading}
          totalCount={totalCount}
          efficiency={efficiency}
          tasks={tasks}
          isCelebrating={isCelebrating}
          isHovered={isHovered}
          setIsHovered={setIsHovered}
        />
      );
    }

    return (
      <TodayTaskProgressBarFull
        className={className}
        completedCount={completedCount}
        totalCount={totalCount}
        efficiency={efficiency}
        showEffects={showEffects}
        systemCritical={systemCritical}
        particleData={particleData}
        popupMsg={popupMsg}
        rainEffectData={rainEffectData}
      />
    );
  },
);

TodayTaskProgressBar.displayName = 'TodayTaskProgressBar';

export default TodayTaskProgressBar;
