/**
 * ai-analysis-panel/PromptOptimizationTab.tsx
 *
 * Content panel for the "最適化" (Prompt Optimization) tab of AIAnalysisPanel.
 * Handles loading, error, clarification Q&A, result display, and the initial CTA.
 */

'use client';

import {
  Wand2,
  Loader2,
  AlertCircle,
  HelpCircle,
  CheckCircle2,
  Copy,
  Check,
  Send,
  Sparkles,
} from 'lucide-react';
import type { OptimizedPromptResult } from './types';

/** Returns a human-readable category label for a clarification question. */
function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    scope: 'スコープ',
    technical: '技術的',
    requirements: '要件',
    constraints: '制約',
  };
  return labels[category] ?? category;
}

/** Returns Tailwind badge classes keyed on question category. */
function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    scope: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    technical:
      'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    requirements:
      'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    constraints:
      'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  };
  return (
    colors[category] ??
    'bg-zinc-100 text-zinc-700 dark:bg-indigo-dark-800 dark:text-zinc-400'
  );
}

/** Returns a text color class based on quality score thresholds. */
function getQualityColor(score: number): string {
  if (score >= 80) return 'text-green-600 dark:text-green-400';
  if (score >= 60) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}

type Props = {
  isGeneratingPrompt: boolean;
  promptResult: OptimizedPromptResult | null;
  setPromptResult: (v: OptimizedPromptResult | null) => void;
  promptError: string | null;
  setPromptError: (v: string | null) => void;
  copied: boolean;
  promptAnswers: Record<string, string>;
  setPromptAnswers: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;
  isSubmittingAnswers: boolean;
  onGenerate: () => void;
  onSubmitAnswers: () => Promise<void>;
  onCopy: () => void;
  onUse: () => void;
};

/**
 * Renders the full prompt optimization tab including loading, error, Q&A, result, and CTA states.
 */
export function PromptOptimizationTab({
  isGeneratingPrompt,
  promptResult,
  setPromptResult,
  promptError,
  setPromptError,
  copied,
  promptAnswers,
  setPromptAnswers,
  isSubmittingAnswers,
  onGenerate,
  onSubmitAnswers,
  onCopy,
  onUse,
}: Props) {
  if (isGeneratingPrompt) {
    return (
      <div className="flex items-center gap-3 p-4 bg-zinc-50 dark:bg-indigo-dark-800/50 rounded-lg">
        <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" />
        <span className="text-sm text-zinc-600 dark:text-zinc-400">
          プロンプトを最適化中...
        </span>
      </div>
    );
  }

  if (promptError) {
    return (
      <div className="flex items-center justify-between p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
        <div className="flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500" />
          <span className="text-sm text-red-600 dark:text-red-400">
            {promptError}
          </span>
        </div>
        <button
          onClick={() => {
            setPromptError(null);
            onGenerate();
          }}
          className="text-sm text-red-600 hover:text-red-700 font-medium"
        >
          再試行
        </button>
      </div>
    );
  }

  if (promptResult?.hasQuestions) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
          <HelpCircle className="w-4 h-4" />
          <span className="text-sm font-medium">追加情報が必要です</span>
        </div>
        {promptResult.clarificationQuestions.map((q) => (
          <div
            key={q.id}
            className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {q.question}
              </span>
              {q.isRequired && (
                <span className="text-xs text-red-500">*必須</span>
              )}
              <span
                className={`px-1.5 py-0.5 text-xs rounded ${getCategoryColor(q.category)}`}
              >
                {getCategoryLabel(q.category)}
              </span>
            </div>
            {q.options ? (
              <div className="flex flex-wrap gap-2">
                {q.options.map((opt, i) => (
                  <button
                    key={i}
                    onClick={() =>
                      setPromptAnswers((prev) => ({ ...prev, [q.id]: opt }))
                    }
                    className={`px-2 py-1 text-xs rounded border transition-colors ${
                      promptAnswers[q.id] === opt
                        ? 'border-amber-500 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                        : 'border-zinc-200 dark:border-zinc-700 hover:border-amber-300'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            ) : (
              <input
                type="text"
                value={promptAnswers[q.id] ?? ''}
                onChange={(e) =>
                  setPromptAnswers((prev) => ({
                    ...prev,
                    [q.id]: e.target.value,
                  }))
                }
                placeholder="回答を入力..."
                className="w-full px-3 py-1.5 bg-white dark:bg-indigo-dark-800 border border-zinc-200 dark:border-zinc-700 rounded text-sm"
              />
            )}
          </div>
        ))}
        <div className="flex justify-end gap-2">
          <button
            onClick={() => setPromptResult(null)}
            className="px-3 py-1.5 text-sm text-zinc-600 dark:text-zinc-400"
          >
            キャンセル
          </button>
          <button
            onClick={onSubmitAnswers}
            disabled={isSubmittingAnswers}
            className="flex items-center gap-1 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
          >
            {isSubmittingAnswers ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Send className="w-3 h-3" />
            )}
            送信
          </button>
        </div>
      </div>
    );
  }

  if (promptResult) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              最適化完了
            </span>
            <span
              className={`text-sm ${getQualityColor(promptResult.promptQuality.score)}`}
            >
              (スコア: {promptResult.promptQuality.score}/100)
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={onCopy}
              className="p-1.5 text-zinc-400 hover:text-zinc-600 rounded"
            >
              {copied ? (
                <Check className="w-4 h-4 text-green-500" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
        <div className="bg-zinc-50 dark:bg-indigo-dark-800/50 rounded-lg p-3 font-mono text-xs text-zinc-600 dark:text-zinc-400 max-h-32 overflow-y-auto whitespace-pre-wrap">
          {promptResult.optimizedPrompt}
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => {
              setPromptResult(null);
              onGenerate();
            }}
            className="text-sm text-zinc-500 hover:text-zinc-700"
          >
            再生成
          </button>
          <button
            onClick={onUse}
            className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded transition-colors"
          >
            <Sparkles className="w-3 h-3" />
            使用する
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="text-center py-6">
      <Wand2 className="w-10 h-10 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
        タスク説明をAIエージェント向けに最適化します
      </p>
      <button
        onClick={onGenerate}
        className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
      >
        <Sparkles className="w-4 h-4" />
        プロンプトを生成
      </button>
    </div>
  );
}
