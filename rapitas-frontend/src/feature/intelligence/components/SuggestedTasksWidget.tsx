'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Zap,
  Brain,
  TrendingUp,
  TrendingDown,
  Minus,
  Play,
  EyeOff,
} from 'lucide-react';
import Link from 'next/link';
import {
  useSuggestedTasks,
  type TaskSuggestion,
} from '../hooks/useIntelligence';

const priorityColors: Record<string, string> = {
  urgent: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  medium: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  low: 'bg-gray-100 text-gray-600 dark:bg-gray-900/30 dark:text-gray-400',
};

const focusIcons: Record<string, typeof TrendingUp> = {
  high: TrendingUp,
  medium: Minus,
  low: TrendingDown,
};

const focusColors: Record<string, string> = {
  high: 'text-green-600 dark:text-green-400',
  medium: 'text-yellow-600 dark:text-yellow-400',
  low: 'text-red-500 dark:text-red-400',
};

const SNOOZE_STORAGE_KEY = 'suggested-tasks-snoozed';
const SNOOZE_TTL = 24 * 60 * 60 * 1000; // 24 hours

function getSnoozedTasks(): number[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(SNOOZE_STORAGE_KEY);
    if (!stored) return [];
    const { tasks, timestamp } = JSON.parse(stored);
    if (Date.now() - timestamp > SNOOZE_TTL) {
      localStorage.removeItem(SNOOZE_STORAGE_KEY);
      return [];
    }
    return tasks;
  } catch {
    return [];
  }
}

function addSnoozedTask(taskId: number) {
  if (typeof window === 'undefined') return;
  const snoozed = getSnoozedTasks().filter((id) => id !== taskId);
  snoozed.push(taskId);
  localStorage.setItem(
    SNOOZE_STORAGE_KEY,
    JSON.stringify({ tasks: snoozed, timestamp: Date.now() }),
  );
}

export function SuggestedTasksWidget() {
  const { data, loading, fetch, updateTaskStatus, startPomodoro } =
    useSuggestedTasks();
  const [snoozedTasks, setSnoozedTasks] = useState<number[]>([]);
  const [updatingTask, setUpdatingTask] = useState<number | null>(null);

  useEffect(() => {
    fetch(5);
    setSnoozedTasks(getSnoozedTasks());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStatusChange = useCallback(
    async (task: TaskSuggestion, newStatus: string) => {
      setUpdatingTask(task.taskId);
      const success = await updateTaskStatus(task.taskId, newStatus);
      if (success) {
        fetch(5);
      }
      setUpdatingTask(null);
    },
    [updateTaskStatus, fetch],
  );

  const handleStartToday = useCallback(
    async (task: TaskSuggestion, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setUpdatingTask(task.taskId);
      const statusUpdated = await updateTaskStatus(task.taskId, 'in-progress');
      if (statusUpdated) {
        await startPomodoro(task.taskId);
        fetch(5); // Refresh suggestions
      }
      setUpdatingTask(null);
    },
    [updateTaskStatus, startPomodoro, fetch],
  );

  const handleSnooze = useCallback(
    (task: TaskSuggestion, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      addSnoozedTask(task.taskId);
      setSnoozedTasks(getSnoozedTasks());
    },
    [],
  );

  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-zinc-200 dark:bg-zinc-700 rounded w-40" />
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 bg-zinc-200 dark:bg-zinc-700 rounded-lg"
            />
          ))}
        </div>
      </div>
    );
  }

  const filteredSuggestions =
    data?.suggestions.filter((task) => !snoozedTasks.includes(task.taskId)) ||
    [];

  if (!data || filteredSuggestions.length === 0) {
    return (
      <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
        <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-3 flex items-center gap-2">
          <Zap className="w-5 h-5 text-amber-500" />
          今やるべきタスク
        </h2>
        <div className="py-6 text-center text-sm text-zinc-400 dark:text-zinc-500">
          <Brain className="w-8 h-8 mx-auto mb-2 opacity-50" />
          {data && data.suggestions.length > 0
            ? 'すべてのタスクがスヌーズされています'
            : '提案するタスクがありません'}
        </div>
      </div>
    );
  }

  const FocusIcon = focusIcons[data.focusLevel] || Minus;

  return (
    <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-2">
          <Zap className="w-5 h-5 text-amber-500" />
          今やるべきタスク
        </h2>
        <div
          className={`flex items-center gap-1 text-xs ${focusColors[data.focusLevel]}`}
        >
          <FocusIcon className="w-3.5 h-3.5" />
          <span>{data.message}</span>
        </div>
      </div>

      <div className="space-y-2">
        {filteredSuggestions.slice(0, 5).map((task, index) => (
          <div
            key={task.taskId}
            className="flex items-center gap-3 p-3 rounded-lg bg-zinc-50/50 dark:bg-zinc-700/30 group"
          >
            <div className="flex items-center justify-center w-6 h-6 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-bold shrink-0">
              {index + 1}
            </div>

            <Link href={`/tasks/${task.taskId}`} className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                {task.title}
              </p>
              {task.reasons.length > 0 && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                  {task.reasons[0]}
                </p>
              )}
            </Link>

            <div className="flex items-center gap-2 shrink-0">
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${priorityColors[task.priority] || ''}`}
              >
                {task.priority}
              </span>
              <span className="text-xs text-zinc-400 dark:text-zinc-500">
                {task.score}pt
              </span>

              {/* Status Dropdown */}
              <select
                onChange={(e) => {
                  const val = e.target.value;
                  if (val) {
                    handleStatusChange(task, val);
                    e.target.value = '';
                  }
                }}
                disabled={updatingTask === task.taskId}
                className="text-xs bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded px-2 py-1 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                value=""
              >
                <option value="" disabled>
                  変更
                </option>
                <option value="todo">Todo</option>
                <option value="in-progress">進行中</option>
                <option value="done">完了</option>
              </select>

              {/* Start Today Button */}
              <button
                onClick={(e) => handleStartToday(task, e)}
                disabled={updatingTask === task.taskId}
                className="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 rounded hover:bg-indigo-200 dark:hover:bg-indigo-800/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="ステータスを進行中にしてポモドーロを開始"
              >
                <Play className="w-3 h-3" />
                今日やる
              </button>

              {/* Snooze Button */}
              <button
                onClick={(e) => handleSnooze(task, e)}
                className="p-1.5 text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-600 rounded transition-colors"
                title="24時間スヌーズ"
              >
                <EyeOff className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {snoozedTasks.length > 0 && (
        <div className="mt-2 text-center">
          <button
            onClick={() => {
              localStorage.removeItem(SNOOZE_STORAGE_KEY);
              setSnoozedTasks([]);
            }}
            className="text-[10px] text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
          >
            スヌーズ解除 ({snoozedTasks.length}件)
          </button>
        </div>
      )}
    </div>
  );
}
