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

    try {
      const endTime = new Date();
      const startTime = new Date(store.timerStartTime);

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

      store.stopTimer();
      onUpdate();
    } catch (err) {
      logger.error('Failed to stop timer:', err);
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

    try {
      const endTime = new Date();
      const startTime = new Date(store.timerStartTime);

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

      store.stopTimer();
      onUpdate();
    } catch (err) {
      logger.error('Failed to complete task:', err);
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

      {showBreakDialog && (
        <div className="mb-6 p-6 bg-green-50 dark:bg-green-950 rounded-xl border-2 border-green-500">
          <div className="text-center mb-4">
            <div className="text-lg font-semibold text-green-700 dark:text-green-300 mb-2">
              {t('breakPrompt', { breakType })}
            </div>
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              ({pomodoroCount % 4 === 0 ? '15' : '5'}min)
            </div>
          </div>
          <div className="flex gap-3 justify-center">
            <button
              onClick={handleTakeBreak}
              className="px-6 py-3 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition-colors"
            >
              {t('takeBreak')}
            </button>
            <button
              onClick={handleSkipBreak}
              className="px-6 py-3 bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-900 dark:text-zinc-50 rounded-lg font-medium transition-colors"
            >
              {t('skip')}
            </button>
          </div>
        </div>
      )}

      {showBreakEndDialog && (
        <div className="mb-6 p-6 bg-indigo-50 dark:bg-indigo-950 rounded-xl border-2 border-indigo-500">
          <div className="text-center mb-4">
            <div className="text-lg font-semibold text-indigo-700 dark:text-indigo-300">
              {t('breakEndMessage')}
            </div>
          </div>
          <button
            onClick={handleBreakEnd}
            className="w-full px-6 py-3 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg font-medium transition-colors"
          >
            {t('resumeWork')}
          </button>
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
        />
      )}
    </div>
  );
}
