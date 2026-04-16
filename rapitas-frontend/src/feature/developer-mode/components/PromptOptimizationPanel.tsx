'use client';
// PromptOptimizationPanel

import { Sparkles, Loader2, AlertCircle, Wand2 } from 'lucide-react';
import { usePromptOptimization } from './prompt-optimization/usePromptOptimization';
import { ClarificationQuestionsView } from './prompt-optimization/ClarificationQuestionsView';
import { OptimizationResultView } from './prompt-optimization/OptimizationResultView';

type Props = {
  taskId: number;
  onPromptGenerated?: (prompt: string) => void;
  className?: string;
};

/**
 * Prompt optimization panel supporting idle, loading, questions, and result states.
 *
 * @param props - PromptOptimizationPanel props
 */
export function PromptOptimizationPanel({
  taskId,
  onPromptGenerated,
  className = '',
}: Props) {
  const {
    isGenerating,
    result,
    error,
    showDetails,
    setShowDetails,
    copied,
    answers,
    setAnswers,
    isSubmittingAnswers,
    generatePrompt,
    handleSubmitAnswers,
    handleCopyPrompt,
    handleUsePrompt,
    handleRetry,
    handleReset,
    setResult,
  } = usePromptOptimization(taskId, onPromptGenerated);

  // ── Idle ──
  if (!result && !isGenerating && !error) {
    return (
      <div
        className={`bg-linear-to-br from-indigo-50 to-violet-50 dark:from-indigo-900/20 dark:to-violet-900/20 rounded-xl p-6 border border-indigo-100 dark:border-indigo-800 ${className}`}
      >
        <div className="flex items-center gap-4">
          <div className="p-3 bg-indigo-100 dark:bg-indigo-900/40 rounded-xl">
            <Wand2 className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">
              プロンプト最適化
            </h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
              AIがタスク説明を分析し、エージェント向けに最適化されたプロンプトを生成します。
            </p>
          </div>
          <button
            onClick={() => generatePrompt()}
            disabled={isGenerating}
            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" />
            プロンプトを生成
          </button>
        </div>
      </div>
    );
  }

  // ── Generating ──
  if (isGenerating) {
    return (
      <div
        className={`bg-zinc-50 dark:bg-indigo-dark-800/50 rounded-xl p-8 border border-zinc-200 dark:border-zinc-700 ${className}`}
      >
        <div className="flex flex-col items-center justify-center gap-4">
          <div className="relative">
            <div className="w-16 h-16 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
              <Wand2 className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
            </div>
            <Loader2 className="absolute -top-1 -right-1 w-6 h-6 text-indigo-500 animate-spin" />
          </div>
          <div className="text-center">
            <p className="font-medium text-zinc-900 dark:text-zinc-50">
              プロンプトを最適化中...
            </p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              AIがタスクを分析しています...
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <div
        className={`bg-red-50 dark:bg-red-900/20 rounded-xl p-6 border border-red-200 dark:border-red-800 ${className}`}
      >
        <div className="flex items-center gap-3">
          <AlertCircle className="w-6 h-6 text-red-500" />
          <div className="flex-1">
            <p className="font-medium text-red-700 dark:text-red-300">
              プロンプト生成に失敗しました
            </p>
            <p className="text-sm text-red-600 dark:text-red-400 mt-1">
              {error}
            </p>
          </div>
          <button
            onClick={handleRetry}
            className="px-3 py-1.5 text-sm font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors"
          >
            再試行
          </button>
        </div>
      </div>
    );
  }

  // ── Clarification questions ──
  const shouldShowQuestions =
    (result?.hasQuestions ?? false) &&
    (result?.clarificationQuestions?.length ?? 0) > 0;

  if (shouldShowQuestions && result) {
    return (
      <ClarificationQuestionsView
        questions={result.clarificationQuestions}
        answers={answers}
        isSubmitting={isSubmittingAnswers}
        onAnswerChange={(id, value) =>
          setAnswers((prev) => ({ ...prev, [id]: value }))
        }
        onSubmit={handleSubmitAnswers}
        onCancel={() => setResult(null)}
        className={className}
      />
    );
  }

  // ── Result ──
  if (result) {
    return (
      <OptimizationResultView
        result={result}
        showDetails={showDetails}
        copied={copied}
        onToggleDetails={() => setShowDetails(!showDetails)}
        onCopy={handleCopyPrompt}
        onUse={handleUsePrompt}
        onRegenerate={handleReset}
        className={className}
      />
    );
  }

  return null;
}
