'use client';
import { TimeEntry } from '@/types';
import {
  Icon,
  Circle,
  Play,
  Pause,
  Square,
  Coffee,
  Hourglass,
} from 'lucide-react';
import { fruit } from '@lucide/lab';
import {
  usePomodoroStore,
  formatTime,
  DEFAULT_POMODORO_DURATION,
  DEFAULT_SHORT_BREAK,
  DEFAULT_LONG_BREAK,
} from '../pomodoro/pomodoroStore';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('PomodoroTimer');

// タイマーステータス（コールバック用）
export type PomodoroTimerStatus = {
  isRunning: boolean;
  isPaused: boolean;
  isBreak: boolean;
  pomodoroCount: number;
  remainingSeconds: number;
};

interface PomodoroTimerProps {
  taskId: number;
  taskTitle?: string;
  estimatedHours?: number;
  actualHours?: number;
  timeEntries: TimeEntry[];
  onUpdate: () => void;
  onStatusChange?: (status: PomodoroTimerStatus) => void;
  showTaskTitle?: boolean;
}

export default function PomodoroTimer({
  taskId,
  taskTitle,
  estimatedHours,
  actualHours,
  timeEntries,
  onUpdate,
  onStatusChange,
  showTaskTitle = false,
}: PomodoroTimerProps) {
  const store = usePomodoroStore();

  // このタスクのタイマーかどうか
  const isThisTask = store.taskId === taskId;
  const isTimerRunning = isThisTask && store.isTimerRunning;
  const isPaused = isThisTask && store.isPaused;
  const isBreakTime = isThisTask && store.isBreakTime;
  const pomodoroCount = isThisTask ? store.pomodoroCount : 0;
  const pomodoroSeconds = isThisTask ? store.pomodoroSeconds : 0;
  const workSeconds = isThisTask ? store.workSeconds : 0;
  const accumulatedBreakSeconds = isThisTask
    ? store.accumulatedBreakSeconds
    : 0;
  const showBreakDialog = isThisTask && store.showBreakDialog;
  const showBreakEndDialog = isThisTask && store.showBreakEndDialog;

  const handleStartTimer = async () => {
    try {
      // タイマー状態を開始
      store.startTimer(taskId, taskTitle || 'タスク');

      // タスクのstartedAtを更新
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

    const newActualHours = (actualHours || 0) + workHours;

    try {
      const endTime = new Date();
      const startTime = new Date(store.timerStartTime);

      await fetch(`${API_BASE_URL}/tasks/${taskId}/time-entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          duration: workHours,
          breakDuration: breakHours,
          note: undefined,
          startedAt: startTime.toISOString(),
          endedAt: endTime.toISOString(),
        }),
      });

      await fetch(`${API_BASE_URL}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actualHours: newActualHours,
          startedAt: null,
        }),
      });

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

    try {
      const endTime = new Date();
      const startTime = new Date(store.timerStartTime);

      await fetch(`${API_BASE_URL}/tasks/${taskId}/time-entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          duration: workHours,
          breakDuration: breakHours,
          note: 'タスク完了',
          startedAt: startTime.toISOString(),
          endedAt: endTime.toISOString(),
        }),
      });

      await fetch(`${API_BASE_URL}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actualHours: (actualHours || 0) + workHours,
          status: 'done',
          startedAt: null,
        }),
      });

      store.stopTimer();
      onUpdate();
    } catch (err) {
      logger.error('Failed to complete task:', err);
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

  // 円形プログレスバー用の計算
  const breakDuration =
    pomodoroCount % 4 === 0 ? DEFAULT_LONG_BREAK : DEFAULT_SHORT_BREAK;
  const currentDuration = isBreakTime
    ? breakDuration
    : DEFAULT_POMODORO_DURATION;
  const remainingTime = isBreakTime
    ? breakDuration - pomodoroSeconds
    : DEFAULT_POMODORO_DURATION - pomodoroSeconds;
  const progress = Math.max(
    0,
    Math.min(((currentDuration - remainingTime) / currentDuration) * 100, 100),
  );
  const circumference = 2 * Math.PI * 120;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  const breakType =
    pomodoroCount > 0 && pomodoroCount % 4 === 0 ? '長い休憩' : '短い休憩';

  // 別のタスクでタイマーが動いている場合
  const isOtherTaskRunning = store.isTimerRunning && !isThisTask;

  return (
    <div className="flex flex-col items-center py-8">
      {/* タスク名表示（グローバル表示時のみ） */}
      {showTaskTitle && store.taskTitle && (
        <div className="mb-4 text-sm text-zinc-600 dark:text-zinc-400 w-full text-center">
          タスク:{' '}
          <span className="font-semibold text-zinc-900 dark:text-zinc-50">
            {store.taskTitle}
          </span>
        </div>
      )}

      {/* 別のタスクでタイマーが動いている場合の警告 */}
      {isOtherTaskRunning && (
        <div className="mb-4 p-4 bg-yellow-50 dark:bg-yellow-950 rounded-xl border border-yellow-500 text-center">
          <p className="text-sm text-yellow-700 dark:text-yellow-300">
            別のタスク「{store.taskTitle}」でタイマーが動作中です
          </p>
        </div>
      )}

      {/* 作業時間と休憩時間 */}
      <div className="flex gap-4 mb-4 text-sm text-zinc-600 dark:text-zinc-400">
        <div className="flex items-center gap-1">
          <Hourglass className="w-4 h-4" />
          <span>作業時間: {formatTime(workSeconds)}</span>
        </div>
        <div className="flex items-center gap-1">
          <Coffee className="w-4 h-4" />
          <span>休憩時間: {formatTime(accumulatedBreakSeconds)}</span>
        </div>
      </div>

      {/* 円形プログレスバーとタイマー */}
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
              isBreakTime
                ? 'text-green-500'
                : isPaused
                  ? 'text-orange-500'
                  : 'text-blue-500'
            }`}
            strokeLinecap="round"
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {/* ポモドーロカウンター */}
          <div className="flex gap-2 mb-8">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i}>
                {i < pomodoroCount % 4 ? (
                  <Icon iconNode={fruit} className="w-5 h-5 text-red-500" />
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
              ? '休憩中'
              : isPaused
                ? '一時停止'
                : isTimerRunning
                  ? '作業中'
                  : '準備完了'}
          </div>
        </div>
      </div>

      {/* 休憩選択UI（25分完了時に表示） */}
      {showBreakDialog && (
        <div className="mb-6 p-6 bg-green-50 dark:bg-green-950 rounded-xl border-2 border-green-500">
          <div className="text-center mb-4">
            <div className="text-lg font-semibold text-green-700 dark:text-green-300 mb-2">
              25分完了！{breakType}を取りますか？
            </div>
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              ({pomodoroCount % 4 === 0 ? '15' : '5'}分)
            </div>
          </div>
          <div className="flex gap-3 justify-center">
            <button
              onClick={handleTakeBreak}
              className="px-6 py-3 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition-colors"
            >
              休憩する
            </button>
            <button
              onClick={handleSkipBreak}
              className="px-6 py-3 bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-900 dark:text-zinc-50 rounded-lg font-medium transition-colors"
            >
              スキップ
            </button>
          </div>
        </div>
      )}

      {/* 休憩終了通知 */}
      {showBreakEndDialog && (
        <div className="mb-6 p-6 bg-blue-50 dark:bg-blue-950 rounded-xl border-2 border-blue-500">
          <div className="text-center mb-4">
            <div className="text-lg font-semibold text-blue-700 dark:text-blue-300">
              休憩終了！作業を再開しましょう
            </div>
          </div>
          <button
            onClick={handleBreakEnd}
            className="w-full px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors"
          >
            作業を再開
          </button>
        </div>
      )}

      {/* コントロールボタン */}
      {!showBreakDialog && !showBreakEndDialog && (
        <div className="flex gap-3 justify-center">
          {isBreakTime ? null : isTimerRunning ? (
            <>
              {isPaused ? (
                <button
                  onClick={handleResumeTimer}
                  className="flex items-center gap-2 px-8 py-4 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-semibold transition-all"
                >
                  <Play className="w-5 h-5" />
                  再開
                </button>
              ) : (
                <button
                  onClick={handlePauseTimer}
                  className="flex items-center gap-2 px-8 py-4 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-semibold transition-all"
                >
                  <Pause className="w-5 h-5" />
                  一時停止
                </button>
              )}
              <button
                onClick={handleCompleteTask}
                className="flex items-center gap-2 px-8 py-4 bg-green-500 hover:bg-green-600 text-white rounded-xl font-semibold transition-all"
              >
                <svg
                  className="w-5 h-5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                完了
              </button>
              <button
                onClick={handleStopTimer}
                className="flex items-center gap-2 px-8 py-4 bg-red-500 hover:bg-red-600 text-white rounded-xl font-semibold transition-all"
              >
                <Square className="w-5 h-5" />
                停止
              </button>
            </>
          ) : (
            <button
              onClick={handleStartTimer}
              disabled={isOtherTaskRunning}
              className="flex items-center gap-2 px-12 py-5 bg-blue-500 hover:bg-blue-600 disabled:bg-zinc-400 disabled:cursor-not-allowed text-white rounded-xl font-bold text-lg transition-all"
            >
              <Play className="w-6 h-6" />
              開始
            </button>
          )}
        </div>
      )}
    </div>
  );
}
