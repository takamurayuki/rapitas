'use client';
import { useState } from 'react';
import { type TimeEntry } from '@/types';
import { Circle, Coffee, Hourglass } from 'lucide-react';
import Tomato from '@/components/icons/Tomato';
import { useTranslations } from 'next-intl';
import {
  usePomodoroStore,
  formatTime,
  DEFAULT_POMODORO_DURATION,
  DEFAULT_SHORT_BREAK,
  DEFAULT_LONG_BREAK,
} from '../../pomodoro/pomodoro-store';
import { syncPomodoroToBackend } from '../../pomodoro/pomodoro-sync';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import { useToast } from '@/components/ui/toast/ToastContainer';
import PomodoroTimerControls from './pomodoro-timer-controls';

const logger = createLogger('PomodoroTimer');

// Timer status (for callbacks)
export type PomodoroTimerStatus = {
  isRunning: boolean;
  isPaused: boolean;
  isBreak: boolean;
  pomodoroCount: number;
  remainingSeconds: number;
};

/** Subtask shape passed in from the parent task. */
export interface PomodoroSubtask {
  id: number;
  title: string;
  estimatedHours?: number | null;
  actualHours?: number | null;
}

interface PomodoroTimerProps {
  taskId: number;
  taskTitle?: string;
  estimatedHours?: number | null;
  actualHours?: number | null;
  timeEntries: TimeEntry[];
  /** Subtasks of the task — enables per-subtask time attribution. */
  subtasks?: PomodoroSubtask[];
  onUpdate: () => void;
  onStatusChange?: (status: PomodoroTimerStatus) => void;
  showTaskTitle?: boolean;
}

export default function PomodoroTimer({
  taskId,
  taskTitle,
  estimatedHours: _estimatedHours,
  actualHours,
  timeEntries: _timeEntries,
  subtasks,
  onUpdate,
  onStatusChange: _onStatusChange,
  showTaskTitle = false,
}: PomodoroTimerProps) {
  const t = useTranslations('pomodoro');
  const tTask = useTranslations('task');
  const store = usePomodoroStore();
  const { showToast } = useToast();

  // NOTE: null = attribute time to the parent task itself
  const [selectedSubtaskId, setSelectedSubtaskId] = useState<number | null>(null);

  // Check if this is the timer for this task
  const isThisTask = store.taskId === taskId;
  const isTimerRunning = isThisTask && store.isTimerRunning;
  const isPaused = isThisTask && store.isPaused;
  const isBreakTime = isThisTask && store.isBreakTime;
  const pomodoroCount = isThisTask ? store.pomodoroCount : 0;
  const pomodoroSeconds = isThisTask ? store.pomodoroSeconds : 0;
  const workSeconds = isThisTask ? store.workSeconds : 0;
  const accumulatedBreakSeconds = isThisTask ? store.accumulatedBreakSeconds : 0;
  const showBreakDialog = isThisTask && store.showBreakDialog;
  const showBreakEndDialog = isThisTask && store.showBreakEndDialog;

  const handleStartTimer = async () => {
    try {
      store.startTimer(taskId, taskTitle || t('taskDefaultName'));

      await fetch(`${API_BASE_URL}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startedAt: new Date().toISOString(),
        }),
      });

      onUpdate();
    } catch (err) {
      logger.error('Failed to start timer:', err);
    }
  };

  const handlePauseTimer = () => {
    store.pauseTimer();
  };

  const handleResumeTimer = () => {
    store.resumeTimer();
  };

  const handleStopTimer = async () => {
    if (!store.timerStartTime) return;

    const workHours = workSeconds / 3600;
    const breakHours = accumulatedBreakSeconds / 3600;

    // NOTE: Time is attributed to the selected subtask when chosen; otherwise the parent task.
    const targetId = selectedSubtaskId ?? taskId;
    const targetPriorActual =
      selectedSubtaskId != null
        ? (subtasks?.find((s) => s.id === selectedSubtaskId)?.actualHours ?? 0)
        : (actualHours ?? 0);
    const newActualHours = targetPriorActual + workHours;

    // Capture before stopTimer resets it, and stop the UI FIRST — a slow or
    // restarting backend must never hold the button hostage (the button read
    // as dead during a backend init window, 2026-09-02).
    const endTime = new Date();
    const startTime = new Date(store.timerStartTime);
    store.stopTimer();

    try {
      await fetch(`${API_BASE_URL}/tasks/${targetId}/time-entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          duration: workHours,
          breakDuration: breakHours,
          startedAt: startTime.toISOString(),
          endedAt: endTime.toISOString(),
        }),
      });

      await fetch(`${API_BASE_URL}/tasks/${targetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actualHours: newActualHours, startedAt: null }),
      });

      // Clear startedAt on the parent task when time was saved to a subtask.
      if (selectedSubtaskId != null) {
        await fetch(`${API_BASE_URL}/tasks/${taskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ startedAt: null }),
        });
      }

      onUpdate();
    } catch (err) {
      logger.error('Failed to stop timer:', err);
      showToast(t('syncFailed'), 'error');
    }
  };

  const handleCompleteTask = async () => {
    if (!store.timerStartTime || isBreakTime) return;

    const workHours = workSeconds / 3600;
    const breakHours = accumulatedBreakSeconds / 3600;

    const targetId = selectedSubtaskId ?? taskId;
    const targetPriorActual =
      selectedSubtaskId != null
        ? (subtasks?.find((s) => s.id === selectedSubtaskId)?.actualHours ?? 0)
        : (actualHours ?? 0);

    // Stop the UI first — see handleStopTimer.
    const endTime = new Date();
    const startTime = new Date(store.timerStartTime);
    store.stopTimer();

    try {
      await fetch(`${API_BASE_URL}/tasks/${targetId}/time-entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          duration: workHours,
          breakDuration: breakHours,
          note: t('complete'),
          startedAt: startTime.toISOString(),
          endedAt: endTime.toISOString(),
        }),
      });

      await fetch(`${API_BASE_URL}/tasks/${targetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actualHours: targetPriorActual + workHours,
          status: 'done',
          startedAt: null,
        }),
      });

      if (selectedSubtaskId != null) {
        await fetch(`${API_BASE_URL}/tasks/${taskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ startedAt: null }),
        });
      }

      onUpdate();
    } catch (err) {
      logger.error('Failed to complete task:', err);
      showToast(t('syncFailed'), 'error');
    }
  };

  const handleCheckpoint = async () => {
    const result = await syncPomodoroToBackend.checkpoint();
    // 0 minutes means either no theme-linked study goal or too little time
    // elapsed to round up to a minute — nothing meaningful to report.
    if (result && result.studyMinutesRecorded > 0) {
      showToast(t('checkpointToast', { minutes: result.studyMinutesRecorded }), 'success');
    }
  };

  const handleTakeBreak = () => {
    store.takeBreak();
  };

  const handleSkipBreak = () => {
    store.skipBreak();
  };

  const handleBreakEnd = () => {
    store.endBreak();
  };

  // Calculations for circular progress bar
  const breakDuration = pomodoroCount % 4 === 0 ? DEFAULT_LONG_BREAK : DEFAULT_SHORT_BREAK;
  const currentDuration = isBreakTime ? breakDuration : DEFAULT_POMODORO_DURATION;
  const remainingTime = isBreakTime
    ? breakDuration - pomodoroSeconds
    : DEFAULT_POMODORO_DURATION - pomodoroSeconds;
  const progress = Math.max(
    0,
    Math.min(((currentDuration - remainingTime) / currentDuration) * 100, 100),
  );
  const circumference = 2 * Math.PI * 120;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  const breakType = pomodoroCount > 0 && pomodoroCount % 4 === 0 ? t('longBreak') : t('shortBreak');

  // When timer is running for a different task
  const isOtherTaskRunning = store.isTimerRunning && !isThisTask;

  return (
    <div className="flex flex-col items-center py-8">
      {showTaskTitle && store.taskTitle && (
        <div className="mb-4 text-sm text-zinc-600 dark:text-zinc-400 w-full text-center">
          {t('taskDefaultName')}:{' '}
          <span className="font-semibold text-zinc-900 dark:text-zinc-50">{store.taskTitle}</span>
        </div>
      )}

      {isOtherTaskRunning && (
        <div className="mb-4 p-4 bg-yellow-50 dark:bg-yellow-950 rounded-xl border border-yellow-500 text-center">
          <p className="text-sm text-yellow-700 dark:text-yellow-300">
            {t('timerRunningOtherTask', { taskTitle: store.taskTitle ?? '' })}
          </p>
        </div>
      )}

      <div className="flex gap-4 mb-4 text-sm text-zinc-600 dark:text-zinc-400">
        <div className="flex items-center gap-1">
          <Hourglass className="w-4 h-4" />
          <span>
            {t('workTimeLabel')} {formatTime(workSeconds)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Coffee className="w-4 h-4" />
          <span>
            {t('breakTimeLabel')} {formatTime(accumulatedBreakSeconds)}
          </span>
        </div>
      </div>

      <div className="relative mb-8">
        <svg className="w-64 h-64 transform -rotate-90">
          <circle
            cx="128"
            cy="128"
            r="120"
            stroke="currentColor"
            strokeWidth="8"
            fill="none"
            className="text-zinc-200 dark:text-zinc-800"
          />
          <circle
            cx="128"
            cy="128"
            r="120"
            stroke="currentColor"
            strokeWidth="8"
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className={`transition-all duration-1000 ${
              isBreakTime ? 'text-green-500' : isPaused ? 'text-orange-500' : 'text-indigo-500'
            }`}
            strokeLinecap="round"
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="flex gap-2 mb-8">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i}>
                {i < pomodoroCount % 4 ? (
                  <Tomato className="w-5 h-5 text-red-500" />
                ) : (
                  <Circle className="w-5 h-5 text-zinc-300 dark:text-zinc-700" />
                )}
              </div>
            ))}
          </div>
          <div className="text-6xl font-bold font-mono text-zinc-900 dark:text-zinc-50">
            {formatTime(remainingTime)}
          </div>
          <div className="text-sm text-zinc-500 dark:text-zinc-400 mt-2">
            {isBreakTime
              ? t('onBreak')
              : isPaused
                ? t('paused')
                : isTimerRunning
                  ? t('working')
                  : t('ready')}
          </div>
        </div>
      </div>

      {/* Compact soft-tint prompt (operator request 2026-09-03): matches the
          control row's visual grammar — pale face, no heavy border, the
          duration as a small chip instead of a bare "(15min)" line. */}
      {/* NOTE: neutral card face — the tinted buttons need contrast against
          it (a green face swallowed the green button, 2026-09-03). */}
      {showBreakDialog && (
        <div className="mb-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-800/50">
          <div className="mb-3 flex items-center justify-center gap-2 text-center">
            <span className="text-sm font-medium text-green-700 dark:text-green-300">
              {t('breakPrompt', { breakType })}
            </span>
            <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-500/20 dark:text-green-300">
              {t('breakDurationChip', { minutes: pomodoroCount % 4 === 0 ? 15 : 5 })}
            </span>
          </div>
          <div className="flex justify-center gap-2">
            <button
              onClick={handleTakeBreak}
              className="rounded-lg bg-green-50 px-4 py-2 text-sm font-medium text-green-600 transition-colors hover:bg-green-100 dark:bg-green-500/15 dark:text-green-400 dark:hover:bg-green-500/25"
            >
              {t('takeBreak')}
            </button>
            <button
              onClick={handleSkipBreak}
              className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              {t('skip')}
            </button>
          </div>
        </div>
      )}

      {/* Same compact grammar as the break prompt, indigo = back-to-work. */}
      {showBreakEndDialog && (
        <div className="mb-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-800/50">
          <div className="mb-3 text-center text-sm font-medium text-indigo-700 dark:text-indigo-300">
            {t('breakEndMessage')}
          </div>
          <div className="flex justify-center">
            <button
              onClick={handleBreakEnd}
              className="rounded-lg bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-600 transition-colors hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-400 dark:hover:bg-indigo-500/25"
            >
              {t('resumeWork')}
            </button>
          </div>
        </div>
      )}

      {/* Subtask selector — pick where to attribute this session's work time */}
      {!showBreakDialog &&
        !showBreakEndDialog &&
        (isTimerRunning || isPaused) &&
        subtasks &&
        subtasks.length > 0 && (
          <div className="w-full mb-4 px-2">
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
              {tTask('pomodoroTimer.subtaskAttributionLabel')}
            </label>
            <select
              value={selectedSubtaskId ?? ''}
              onChange={(e) => setSelectedSubtaskId(e.target.value ? Number(e.target.value) : null)}
              className="w-full px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <option value="">
                {tTask('pomodoroTimer.parentTaskOption', { taskTitle: taskTitle ?? '' })}
              </option>
              {subtasks.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                  {s.estimatedHours
                    ? tTask('pomodoroTimer.subtaskEstimatedHoursSuffix', {
                        hours: s.estimatedHours,
                      })
                    : ''}
                </option>
              ))}
            </select>
          </div>
        )}

      {!showBreakDialog && !showBreakEndDialog && (
        <PomodoroTimerControls
          isBreakTime={isBreakTime}
          isTimerRunning={isTimerRunning}
          isPaused={isPaused}
          isOtherTaskRunning={isOtherTaskRunning}
          onStart={handleStartTimer}
          onPause={handlePauseTimer}
          onResume={handleResumeTimer}
          onComplete={handleCompleteTask}
          onStop={handleStopTimer}
          onCheckpoint={handleCheckpoint}
          onCutBreak={() => store.cutBreakShort()}
        />
      )}
    </div>
  );
}
