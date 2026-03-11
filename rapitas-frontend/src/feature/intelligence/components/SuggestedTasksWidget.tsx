'use client';

import { useEffect } from 'react';
import {
  Zap,
  ArrowRight,
  Brain,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react';
import Link from 'next/link';
import { useSuggestedTasks } from '../hooks/useIntelligence';

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

export function SuggestedTasksWidget() {
  const { data, loading, fetch } = useSuggestedTasks();

  useEffect(() => {
    fetch(5);
  }, [fetch]);

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

  if (!data || data.suggestions.length === 0) {
    return (
      <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
        <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-3 flex items-center gap-2">
          <Zap className="w-5 h-5 text-amber-500" />
          今やるべきタスク
        </h2>
        <div className="py-6 text-center text-sm text-zinc-400 dark:text-zinc-500">
          <Brain className="w-8 h-8 mx-auto mb-2 opacity-50" />
          提案するタスクがありません
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
        {data.suggestions.slice(0, 5).map((task, index) => (
          <Link
            key={task.taskId}
            href={`/tasks/${task.taskId}`}
            className="flex items-center gap-3 p-3 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors group"
          >
            <div className="flex items-center justify-center w-6 h-6 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-bold shrink-0">
              {index + 1}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                {task.title}
              </p>
              {task.reasons.length > 0 && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                  {task.reasons[0]}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${priorityColors[task.priority] || ''}`}
              >
                {task.priority}
              </span>
              <span className="text-xs text-zinc-400 dark:text-zinc-500">
                {task.score}pt
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
