'use client';
// TaskCardSubtaskProgress
import type { Task } from '@/types';
import { statusConfig, isInProgressStatus } from '@/feature/tasks/config/StatusConfig';

interface TaskCardSubtaskProgressProps {
  subtasks: Task[];
  expanded: boolean;
  onToggle: () => void;
  /** Localized "subtasks" label used for the accessible name. / アクセシブルネーム用ラベル */
  label: string;
}

/**
 * Expand toggle + segmented subtask progress bar on a task card.
 *
 * The whole row (chevron, count, bar) is a single button so the bar itself is a
 * click target for expanding the subtask list. Segment hues follow the
 * app-wide status vocabulary (green = done, blue = in-progress) — replaced the
 * old rate-based indigo/orange gradients, which read as warnings at low
 * progress and violated the one-hue-per-meaning rule (ui-design-language.md §4).
 *
 * @param props - Subtask list, expansion state, toggle callback, and label.
 */
export default function TaskCardSubtaskProgress({
  subtasks,
  expanded,
  onToggle,
  label,
}: TaskCardSubtaskProgressProps) {
  const total = subtasks.length;
  if (total === 0) return null;

  const done = subtasks.filter((s) => s.status === 'done').length;
  // 'blocked' is surfaced as 進行中 app-wide, so count it into the blue segment.
  const inProgress = subtasks.filter((s) => isInProgressStatus(s.status)).length;
  const donePct = Math.round((done / total) * 100);
  const inProgressPct = Math.round((inProgress / total) * 100);
  const isComplete = done === total;
  const breakdown = `${statusConfig.done.label} ${done} / ${statusConfig['in-progress'].label} ${inProgress} / ${statusConfig.todo.label} ${total - done - inProgress}`;

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`shrink-0 flex items-center gap-1.5 -ml-1.5 -my-1 px-1.5 py-1 rounded-md font-medium transition-colors duration-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-700/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
        isComplete ? 'text-green-600 dark:text-green-400' : 'text-indigo-600 dark:text-indigo-400'
      }`}
      aria-expanded={expanded}
      aria-label={`${label} ${done}/${total}`}
      title={breakdown}
    >
      <svg
        className={`w-3 h-3 transition-transform duration-200 ease-out ${
          expanded ? 'rotate-90' : ''
        }`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
      <span className="tabular-nums">
        {done}/{total}
      </span>
      {/* Counts are conveyed via the button's accessible name + title, so the
          decorative bar is aria-hidden. */}
      <div
        className="flex w-20 sm:w-32 md:w-48 h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden"
        aria-hidden="true"
      >
        <div
          className="h-full bg-green-500 transition-all duration-300 ease-out"
          style={{ width: `${donePct}%` }}
        />
        <div
          className="h-full bg-blue-500 transition-all duration-300 ease-out"
          style={{ width: `${inProgressPct}%` }}
        />
      </div>
    </button>
  );
}
