'use client';
// AutoExecutionMode — category-scoped auto task generation with IdeaBox integration.
import { useState, useCallback } from 'react';
import {
  Bot,
  Loader2,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  X,
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
  ideasUsed?: number;
  insufficientData?: boolean;
  completedTaskCount?: number;
  innovationTriggered?: boolean;
  error?: string;
}

interface AutoExecutionModeProps {
  categoryId?: number | null;
}

export function AutoExecutionMode({ categoryId }: AutoExecutionModeProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<GeneratedTask[] | null>(null);
  const [ideasUsed, setIdeasUsed] = useState(0);
  const [innovationTriggered, setInnovationTriggered] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showThresholdModal, setShowThresholdModal] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);

  const doGenerate = useCallback(
    async (force = false) => {
      setIsGenerating(true);
      setError(null);
      setResult(null);
      setShowThresholdModal(false);

      try {
        const res = await fetch(`${API_BASE_URL}/tasks/auto-generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            autoExecute: true,
            categoryId: categoryId ?? null,
            force,
          }),
        });

        const data = (await res.json()) as AutoGenerateResponse;

        if (!res.ok || !data.success) {
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }

        if (data.insufficientData && !force) {
          setCompletedCount(data.completedTaskCount ?? 0);
          setShowThresholdModal(true);
          return;
        }

        setResult(data.tasks ?? []);
        setIdeasUsed(data.ideasUsed ?? 0);
        setInnovationTriggered(data.innovationTriggered ?? false);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'タスク自動生成に失敗しました',
        );
      } finally {
        setIsGenerating(false);
      }
    },
    [categoryId],
  );

  const handleAutoGenerate = useCallback(() => doGenerate(false), [doGenerate]);
  const handleForceGenerate = useCallback(() => doGenerate(true), [doGenerate]);

  return (
    <div className="space-y-3">
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

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {result && result.length > 0 && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-900/30">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            {result.length}件のタスクを自動生成しました
            {ideasUsed > 0 && (
              <span className="text-[10px] font-normal text-emerald-600 dark:text-emerald-400">
                （アイデア{ideasUsed}件活用）
              </span>
            )}
            {innovationTriggered && (
              <span className="text-[10px] font-normal text-violet-600 dark:text-violet-400">
                + 革新アイデア生成
              </span>
            )}
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
                    href={`/tasks/${task.taskId}`}
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

      {/* Insufficient data modal */}
      {showThresholdModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowThresholdModal(false)}
        >
          <div
            className="mx-4 w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-700 dark:bg-zinc-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-5 w-5" />
                <h3 className="text-base font-semibold">
                  学習データが不足しています
                </h3>
              </div>
              <button
                onClick={() => setShowThresholdModal(false)}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
              精度の高いタスク自動生成には、最低10件の完了タスクが必要です。
            </p>
            <p className="mb-6 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              現在の完了タスク数:{' '}
              <span className="text-amber-600 dark:text-amber-400">
                {completedCount}件
              </span>
              <span className="text-zinc-500"> / 10件</span>
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowThresholdModal(false)}
                className="flex-1 rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-700"
              >
                閉じる
              </button>
              <button
                onClick={handleForceGenerate}
                className="flex-1 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
              >
                強制実行
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
