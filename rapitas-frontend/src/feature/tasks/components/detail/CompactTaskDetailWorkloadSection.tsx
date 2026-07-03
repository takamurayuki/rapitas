/**
 * CompactTaskDetailWorkloadSection
 *
 * Workload/deadline accordion body for CompactTaskDetailCard: estimated vs.
 * actual hours inputs, due-date input, a live progress bar, and the
 * read-only label list. Extracted from the card component to keep it under
 * the size limit; markup and behavior are unchanged.
 */
'use client';
import { type useTranslations } from 'next-intl';
import { type Task, type Label } from '@/types';
import { SelectedLabelsDisplay } from '@/feature/tasks/components/LabelSelector';
import { Calendar, Clock, Timer, Tag } from 'lucide-react';

export interface CompactTaskDetailWorkloadSectionProps {
  task: Task;
  /** `useTranslations('task')` from the parent — kept as a prop to avoid a duplicate hook call. */
  t: ReturnType<typeof useTranslations<'task'>>;
  estHoursInput: string;
  setEstHoursInput: (value: string) => void;
  actHoursInput: string;
  setActHoursInput: (value: string) => void;
  dueDateInput: string;
  setDueDateInput: (value: string) => void;
  patchTask: (data: Record<string, unknown>) => Promise<void>;
}

/** Workload/deadline accordion body (hours inputs + progress bar + labels). */
export default function CompactTaskDetailWorkloadSection({
  task,
  t,
  estHoursInput,
  setEstHoursInput,
  actHoursInput,
  setActHoursInput,
  dueDateInput,
  setDueDateInput,
  patchTask,
}: CompactTaskDetailWorkloadSectionProps) {
  // NOTE: Use local input state for the progress bar so it updates on keystroke,
  // not only after the parent re-fetches the task on blur.
  const displayedEst = estHoursInput ? parseFloat(estHoursInput) : null;
  const displayedAct = actHoursInput ? parseFloat(actHoursInput) : 0;
  const hasEst = displayedEst != null && displayedEst > 0;
  const pct = hasEst ? Math.min(100, (displayedAct / displayedEst) * 100) : 0;
  const barColor = !hasEst
    ? 'bg-green-500/30'
    : displayedAct > displayedEst
      ? 'bg-red-500'
      : displayedAct >= displayedEst * 0.8
        ? 'bg-amber-500'
        : 'bg-green-500';

  return (
    <div className="space-y-4">
      {/* 工数 / 作業時間 / 期限 — 3列横並び */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {t('compactTaskDetailCard.workloadLabel')}
            </span>
          </label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              step="0.5"
              min="0"
              value={estHoursInput}
              onChange={(e) => setEstHoursInput(e.target.value)}
              onBlur={() =>
                patchTask({
                  estimatedHours: estHoursInput ? parseFloat(estHoursInput) : null,
                })
              }
              placeholder="0"
              aria-label={t('compactTaskDetailCard.workloadLabel')}
              className="w-full bg-zinc-100 dark:bg-zinc-800 rounded-lg px-2 py-1.5 text-sm border-none outline-none focus:ring-2 focus:ring-violet-500/20 transition-all"
            />
            <span className="text-xs text-zinc-500 dark:text-zinc-400 shrink-0">h</span>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
            <span className="flex items-center gap-1">
              <Timer className="w-3.5 h-3.5" />
              {t('compactTaskDetailCard.actualWorkTimeLabel')}
            </span>
          </label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              step="0.1"
              min="0"
              value={actHoursInput}
              onChange={(e) => setActHoursInput(e.target.value)}
              onBlur={() =>
                patchTask({
                  actualHours: actHoursInput ? parseFloat(actHoursInput) : null,
                })
              }
              placeholder="0"
              aria-label={t('compactTaskDetailCard.actualWorkTimeLabel')}
              className="w-full bg-zinc-100 dark:bg-zinc-800 rounded-lg px-2 py-1.5 text-sm border-none outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all"
            />
            <span className="text-xs text-zinc-500 dark:text-zinc-400 shrink-0">h</span>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
            <span className="flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              {t('dueDate')}
            </span>
          </label>
          <input
            type="datetime-local"
            value={dueDateInput}
            onChange={(e) => setDueDateInput(e.target.value)}
            onBlur={() =>
              patchTask({
                dueDate: dueDateInput ? new Date(dueDateInput).toISOString() : null,
              })
            }
            aria-label={t('dueDate')}
            className="w-full bg-zinc-100 dark:bg-zinc-800 rounded-lg px-2 py-1.5 text-sm border-none outline-none focus:ring-2 focus:ring-violet-500/20 transition-all"
          />
        </div>
      </div>

      {/* 進捗バー: 作業時間 / 工数 (入力値をリアルタイム反映) */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {t('compactTaskDetailCard.progressLabel')}
          </span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {displayedAct.toFixed(1)}h{hasEst ? ` / ${displayedEst}h` : ''}
            {hasEst && (
              <span className="ml-1 text-zinc-500 dark:text-zinc-500">({pct.toFixed(0)}%)</span>
            )}
          </span>
        </div>
        <div className="h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-150 ${barColor}`}
            style={{ width: hasEst ? `${pct}%` : displayedAct > 0 ? '100%' : '0%' }}
          />
        </div>
      </div>

      {/* Labels (read-only display) */}
      {task.taskLabels && task.taskLabels.length > 0 && (
        <div>
          <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
            <span className="flex items-center gap-1">
              <Tag className="w-3.5 h-3.5" />
              {t('labels')}
            </span>
          </label>
          <SelectedLabelsDisplay
            labels={task.taskLabels
              .map((tl) => tl.label)
              .filter((l): l is Label => l !== undefined)}
          />
        </div>
      )}
    </div>
  );
}
