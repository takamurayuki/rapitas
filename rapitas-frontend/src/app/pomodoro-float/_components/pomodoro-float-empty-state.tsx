/**
 * pomodoroFloatEmptyState
 *
 * Task-first idle UI for the floating window (operator design A, 2026-09-02):
 * shows the last-used task with a one-click Start, plus a lightweight picker
 * to switch tasks. Taskless sessions are NOT offered — the operator's
 * workflow is fully task-driven, and taskless time never reaches the
 * theme-linked study aggregation. Start stays disabled until a task exists.
 */
'use client';

import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { usePomodoroStore, formatTime } from '@/feature/tasks/pomodoro/pomodoro-store';

const TINT_BASE =
  'flex items-center justify-center gap-2 rounded-lg px-6 py-2.5 text-sm font-medium ' +
  'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';
const TINT_INDIGO =
  'bg-indigo-50 text-indigo-600 hover:bg-indigo-100 ' +
  'dark:bg-indigo-500/15 dark:text-indigo-400 dark:hover:bg-indigo-500/25';

interface TaskOption {
  id: number;
  title: string;
}

export default function PomodoroFloatEmptyState() {
  const t = useTranslations('pomodoro');
  const { lastUsedTaskId, lastUsedTaskTitle, settings, startTimer } = usePomodoroStore();
  const [tasks, setTasks] = useState<TaskOption[]>([]);
  // The task the next session will start on: last used by default.
  const [selected, setSelected] = useState<TaskOption | null>(
    lastUsedTaskId !== null ? { id: lastUsedTaskId, title: lastUsedTaskTitle ?? '' } : null,
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Active work candidates, newest first — enough for a quick switch.
        const res = await fetch(`${API_BASE_URL}/tasks?status=in-progress&limit=20`);
        const res2 = await fetch(`${API_BASE_URL}/tasks?status=todo&limit=20`);
        const a = res.ok ? ((await res.json()) as TaskOption[]) : [];
        const b = res2.ok ? ((await res2.json()) as TaskOption[]) : [];
        if (!cancelled) setTasks([...a, ...b].map(({ id, title }) => ({ id, title })));
      } catch {
        /* picker stays empty; last-used start still works */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pick = (value: string) => {
    const id = parseInt(value);
    const found = tasks.find((task) => task.id === id);
    if (found) setSelected(found);
  };

  return (
    <div className="flex flex-col items-center gap-3">
      {selected ? (
        <p
          className="max-w-full truncate px-4 text-center text-sm text-zinc-700 dark:text-zinc-300"
          title={selected.title}
        >
          {selected.title || t('taskDefaultName')}
        </p>
      ) : (
        <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
          {t('floatPickTaskPrompt')}
        </p>
      )}
      {tasks.length > 0 && (
        <select
          value={selected?.id ?? ''}
          onChange={(e) => pick(e.target.value)}
          aria-label={t('floatPickTaskLabel')}
          className="w-56 max-w-full rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 outline-none focus-visible:ring-1 focus-visible:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
        >
          <option value="" disabled>
            {t('floatPickTaskLabel')}
          </option>
          {tasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.title}
            </option>
          ))}
        </select>
      )}
      <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {formatTime(settings.pomodoroDuration)}
      </p>
      <button
        type="button"
        onClick={() => selected && startTimer(selected.id, selected.title || null)}
        disabled={!selected}
        className={`${TINT_BASE} ${TINT_INDIGO}`}
        title={selected ? t('start') : t('floatPickTaskPrompt')}
      >
        <Play className="h-4 w-4" />
        {t('start')}
      </button>
    </div>
  );
}
