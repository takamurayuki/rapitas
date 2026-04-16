'use client';
// AutoExecutionMode
import { useState, useCallback } from 'react';
import {
  Bot,
  Loader2,
  Sparkles,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';

interface GeneratedTask {
  taskId: number;
  title: string;
  description: string;
  priority: string;
  reasoning: string;
}

interface AutoGenerateResponse {
  success: boolean;
  tasks?: GeneratedTask[];
  count?: number;
  error?: string;
}

export function AutoExecutionMode() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<GeneratedTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAutoGenerate = useCallback(async () => {
    setIsGenerating(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`${API_BASE_URL}/tasks/auto-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoExecute: true }),
      });

      const data = (await res.json()) as AutoGenerateResponse;

      if (!res.ok || !data.success) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      setResult(data.tasks ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'タスク自動生成に失敗しました',
      );
    } finally {
      setIsGenerating(false);
    }
  }, []);

  return (
    <div className="space-y-3">
      {/* Toggle Button */}
      <button
        onClick={handleAutoGenerate}
        disabled={isGenerating}
        className="inline-flex items-center gap-2 rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 shadow-sm transition-colors hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50"
      >
        {isGenerating ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Bot className="h-4 w-4" />
        )}
        {isGenerating ? 'AIがタスクを分析中...' : '自動実行モード'}
        <Sparkles className="h-3 w-3 text-indigo-400" />
      </button>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Generated Tasks */}
      {result && result.length > 0 && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-900/30">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            {result.length}件のタスクを自動生成しました
          </div>
          <ul className="space-y-1.5">
            {result.map((task) => (
              <li
                key={task.taskId}
                className="flex items-start gap-2 text-xs text-emerald-700 dark:text-emerald-400"
              >
                <span className="mt-0.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-500" />
                <div>
                  <a
                    href={`/task-detail/${task.taskId}`}
                    className="font-medium underline decoration-emerald-300 underline-offset-2 hover:decoration-emerald-500"
                  >
                    {task.title}
                  </a>
                  <span className="ml-2 text-emerald-600/70 dark:text-emerald-500/70">
                    — {task.reasoning}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result && result.length === 0 && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
          現在追加すべきタスクは見つかりませんでした。
        </div>
      )}
    </div>
  );
}
