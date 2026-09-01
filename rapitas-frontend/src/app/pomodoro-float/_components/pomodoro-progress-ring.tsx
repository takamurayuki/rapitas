/**
 * pomodoroProgressRing
 *
 * Pure circular progress indicator for the Pomodoro floating window. No
 * data fetching or store access — takes remaining/total seconds and draws
 * an SVG ring via stroke-dasharray.
 */
'use client';

import type { ReactNode } from 'react';

interface PomodoroProgressRingProps {
  remainingSeconds: number;
  totalSeconds: number;
  isBreakTime: boolean;
  children?: ReactNode;
}

const SIZE = 120;
const STROKE_WIDTH = 8;
const RADIUS = (SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function PomodoroProgressRing({
  remainingSeconds,
  totalSeconds,
  isBreakTime,
  children,
}: PomodoroProgressRingProps) {
  // totalSeconds === 0 guard: divide-by-zero would otherwise produce a NaN
  // dasharray offset and hide the ring entirely.
  const progress =
    totalSeconds > 0 ? Math.min(1, Math.max(0, 1 - remainingSeconds / totalSeconds)) : 0;
  const dashOffset = CIRCUMFERENCE * (1 - progress);

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={SIZE} height={SIZE} className="-rotate-90">
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE_WIDTH}
          className="stroke-zinc-200/70 dark:stroke-zinc-700/70"
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          className={isBreakTime ? 'stroke-green-500' : 'stroke-indigo-500'}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}
