/**
 * PomodoroPanelContent
 *
 * The single UI implementation of the Pomodoro panel: task link, timer body,
 * control row, today's stats, and the settings accordion. Rendered by the
 * Pomodoro floating window — the only surface that shows it now that the
 * global Pomodoro modal has been removed. Owns fetching the task's time
 * entries/estimate/subtasks so the timer has the context it needs.
 */
'use client';

import { useEffect, useState } from 'react';
import { Settings, Volume2, VolumeX, BarChart3, ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import PomodoroTimer, {
  type PomodoroSubtask,
} from '@/feature/tasks/components/timer/PomodoroTimer';
import { usePomodoroStore, formatTime } from './pomodoro-store';
import { type TimeEntry } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('PomodoroPanelContent');

// Ask the Rust side to front the main window and route it to the task page.
async function openTaskInMainWindow(taskId: number): Promise<void> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_task_in_main', { taskId });
  } catch (err) {
    logger.error('Failed to open task in main window:', err);
  }
}

interface PomodoroPanelContentProps {
  taskId: number;
  taskTitle: string;
  focusMode: boolean;
}

interface FetchedTaskData {
  estimatedHours?: number;
  actualHours?: number;
  subtasks?: PomodoroSubtask[];
}

export default function PomodoroPanelContent({
  taskId,
  taskTitle,
  focusMode,
}: PomodoroPanelContentProps) {
  const t = useTranslations('pomodoro');
  const state = usePomodoroStore();
  const { stopTimer } = state;
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [taskData, setTaskData] = useState<FetchedTaskData | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const fetchTaskContext = () => {
    fetch(`${API_BASE_URL}/tasks/${taskId}/time-entries`)
      .then((res) => {
        if (!res.ok) return [];
        return res.json();
      })
      .then((data) => setTimeEntries(data))
      .catch((err) => logger.error('Failed to fetch time entries:', err));

    fetch(`${API_BASE_URL}/tasks/${taskId}`)
      .then((res) => {
        if (!res.ok) {
          logger.info('Task not found, stopping timer');
          stopTimer();
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data) {
          setTaskData({
            estimatedHours: data.estimatedHours,
            actualHours: data.actualHours,
            subtasks: (data.subtasks ?? []).map(
              (s: {
                id: number;
                title: string;
                estimatedHours?: number | null;
                actualHours?: number | null;
              }) => ({
                id: s.id,
                title: s.title,
                estimatedHours: s.estimatedHours,
                actualHours: s.actualHours,
              }),
            ),
          });
        }
      })
      .catch((err) => logger.error('Failed to fetch task:', err));
  };

  // Re-fetch when the target task changes; stopTimer is a stable store action.
  useEffect(fetchTaskContext, [taskId, stopTimer]);

  // Re-fetch on every SHOW of the float window: subtasks added from the main
  // window while the float was hidden must appear in the selector (operator
  // report 2026-09-03). The window is long-lived, so mount-time fetches alone
  // go stale.
  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<boolean>('pomodoro-float://visibility-changed', (event) => {
        if (event.payload) fetchTaskContext();
      }).then((fn) => {
        unlisten = fn;
      });
    });
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchTaskContext is recreated per render; the listener only needs the latest via closure re-registration on taskId change
  }, [taskId]);

  return (
    <div>
      {!focusMode && (
        <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-800 rounded-t-xl">
          {/* Fronts the MAIN window on that task's page (open_task_in_main →
              TaskNavigateListener) — the float itself must never navigate. */}
          <button
            type="button"
            onClick={() => void openTaskInMainWindow(taskId)}
            title={t('floatGoToTask')}
            className="block max-w-full truncate text-left text-sm text-blue-600 hover:underline dark:text-blue-400"
          >
            {taskTitle}
          </button>
        </div>
      )}

      <div className="p-4">
        <PomodoroTimer
          taskId={taskId}
          taskTitle={taskTitle}
          showTaskTitle={false}
          focusMode={focusMode}
          estimatedHours={taskData?.estimatedHours}
          actualHours={taskData?.actualHours}
          subtasks={taskData?.subtasks}
          timeEntries={timeEntries}
          onUpdate={fetchTaskContext}
        />
      </div>

      {!focusMode && (
        <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 border-t border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="w-4 h-4 text-emerald-500" />
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t('todayStats')}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white dark:bg-zinc-900 rounded-lg p-3 border border-zinc-200 dark:border-zinc-700">
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                {state.todayCompletedPomodoros || 0}
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                {t('completedPomodoros')}
              </div>
            </div>
            <div className="bg-white dark:bg-zinc-900 rounded-lg p-3 border border-zinc-200 dark:border-zinc-700">
              <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                {formatTime(state.todayTotalWorkSeconds || 0)}
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">{t('totalWorkTime')}</div>
            </div>
          </div>
        </div>
      )}

      {!focusMode && (
        <div className="border-t border-zinc-200 dark:border-zinc-800 rounded-b-xl overflow-hidden">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="w-full px-4 py-3 flex items-center justify-between text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4" />
              {t('settings')}
            </div>
            {showSettings ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {showSettings && (
            <div className="px-4 pb-4 space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-zinc-600 dark:text-zinc-400">
                    {t('notificationSound')}
                  </label>
                  <button
                    onClick={() =>
                      state.updateSettings({
                        soundEnabled: !state.settings.soundEnabled,
                      })
                    }
                    className={`p-2 rounded-lg transition-colors ${
                      state.settings.soundEnabled
                        ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {state.settings.soundEnabled ? (
                      <Volume2 className="w-4 h-4" />
                    ) : (
                      <VolumeX className="w-4 h-4" />
                    )}
                  </button>
                </div>
                {state.settings.soundEnabled && (
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-zinc-500">{t('volumeLow')}</span>
                    <input
                      type="range"
                      aria-label={t('notificationSound')}
                      min="0.1"
                      max="1"
                      step="0.1"
                      value={state.settings.soundVolume}
                      onChange={(e) =>
                        state.updateSettings({
                          soundVolume: parseFloat(e.target.value),
                        })
                      }
                      className="flex-1 h-2 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                    <span className="text-xs text-zinc-500">{t('volumeHigh')}</span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                    {t('workDuration')}
                  </label>
                  <select
                    value={state.settings.pomodoroDuration / 60}
                    onChange={(e) =>
                      state.updateSettings({
                        pomodoroDuration: parseInt(e.target.value) * 60,
                      })
                    }
                    className="w-full px-2 py-1.5 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg"
                  >
                    {[15, 20, 25, 30, 45, 60].map((min) => (
                      <option key={min} value={min}>
                        {t('minutes', { count: min })}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                    {t('shortBreak')}
                  </label>
                  <select
                    value={state.settings.shortBreakDuration / 60}
                    onChange={(e) =>
                      state.updateSettings({
                        shortBreakDuration: parseInt(e.target.value) * 60,
                      })
                    }
                    className="w-full px-2 py-1.5 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg"
                  >
                    {[3, 5, 10, 15].map((min) => (
                      <option key={min} value={min}>
                        {t('minutes', { count: min })}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                    {t('longBreak')}
                  </label>
                  <select
                    value={state.settings.longBreakDuration / 60}
                    onChange={(e) =>
                      state.updateSettings({
                        longBreakDuration: parseInt(e.target.value) * 60,
                      })
                    }
                    className="w-full px-2 py-1.5 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg"
                  >
                    {[10, 15, 20, 30].map((min) => (
                      <option key={min} value={min}>
                        {t('minutes', { count: min })}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
