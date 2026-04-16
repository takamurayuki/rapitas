'use client';
// PromptPanel

import {
  Wand2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sparkles,
  HelpCircle,
  Send,
  Copy,
  Check,
} from 'lucide-react';
import type { PromptResult, PromptClarificationQuestion } from './types';

export type PromptPanelProps = {
  isGeneratingPrompt: boolean;
  promptResult: PromptResult | null;
  promptError: string | null;
  questionAnswers: Record<string, string>;
  isSubmittingAnswers: boolean;
  copied: boolean;
  onSetQuestionAnswer: (id: string, value: string) => void;
  onCancelQuestions: () => void;
  onSubmitAnswers: () => Promise<void>;
  onCopyPrompt: () => void;
  onUsePrompt: () => void;
  onRegeneratePrompt: () => void;
  onGeneratePrompt: () => void;
  onRetryPrompt: () => void;
  getCategoryLabel: (category: string) => string;
};

/**
 * Tab panel for prompt generation and clarification Q&A flow.
 *
 * @param props.promptResult - When set with hasQuestions=false, shows the result view.
 * @param props.onSubmitAnswers - Called after the user fills in clarification answers.
 */
export function PromptPanel({
  isGeneratingPrompt,
  promptResult,
  promptError,
  questionAnswers,
  isSubmittingAnswers,
  copied,
  onSetQuestionAnswer,
  onCancelQuestions,
  onSubmitAnswers,
  onCopyPrompt,
  onUsePrompt,
  onRegeneratePrompt,
  onGeneratePrompt,
  onRetryPrompt,
  getCategoryLabel,
}: PromptPanelProps) {
  if (isGeneratingPrompt) {
    return (
      <div
        id="prompt-panel"
        role="tabpanel"
        className="flex items-center gap-2 p-2.5 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg"
      >
        <Loader2 className="w-3.5 h-3.5 text-indigo-500 animate-spin" />
        <span className="text-xs text-zinc-600 dark:text-zinc-400">
          最適化中...
        </span>
      </div>
    );
  }

  if (promptError) {
    return (
      <div
        id="prompt-panel"
        role="tabpanel"
        className="flex items-center justify-between p-2 bg-red-50 dark:bg-red-900/20 rounded-lg"
      >
        <div className="flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 text-red-500" />
          <span className="text-[10px] text-red-600 dark:text-red-400 line-clamp-1">
            {promptError}
          </span>
        </div>
        <button
          onClick={onRetryPrompt}
          className="text-[10px] text-red-600 hover:text-red-700 font-medium shrink-0"
        >
          再試行
        </button>
      </div>
    );
  }

  const hasQuestions =
    promptResult?.hasQuestions &&
    promptResult.clarificationQuestions &&
    promptResult.clarificationQuestions.length > 0;

  if (hasQuestions && promptResult?.clarificationQuestions) {
    return (
      <ClarificationQuestionsView
        questions={promptResult.clarificationQuestions}
        score={promptResult.promptQuality.score}
        questionAnswers={questionAnswers}
        isSubmittingAnswers={isSubmittingAnswers}
        onSetQuestionAnswer={onSetQuestionAnswer}
        onCancel={onCancelQuestions}
        onSubmit={onSubmitAnswers}
        getCategoryLabel={getCategoryLabel}
      />
    );
  }

  if (promptResult) {
    return (
      <div id="prompt-panel" role="tabpanel" className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3 h-3 text-green-500" />
            <span className="text-[10px] text-zinc-700 dark:text-zinc-300">
              スコア: {promptResult.promptQuality.score}/100
            </span>
          </div>
          <button
            onClick={onCopyPrompt}
            className="p-1 text-zinc-400 hover:text-zinc-600 rounded"
            aria-label="プロンプトをコピー"
          >
            {copied ? (
              <Check className="w-3 h-3 text-green-500" />
            ) : (
              <Copy className="w-3 h-3" />
            )}
          </button>
        </div>
        <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded p-2 font-mono text-[10px] text-zinc-600 dark:text-zinc-400 max-h-20 overflow-y-auto whitespace-pre-wrap">
          {promptResult.optimizedPrompt.length > 150
            ? `${promptResult.optimizedPrompt.slice(0, 150)}...`
            : promptResult.optimizedPrompt}
        </div>
        <div className="flex justify-end gap-1.5">
          <button
            onClick={onRegeneratePrompt}
            className="text-[10px] text-zinc-500 hover:text-zinc-700 px-2 py-1"
          >
            再生成
          </button>
          <button
            onClick={onUsePrompt}
            className="flex items-center gap-1 px-2 py-1 bg-green-600 hover:bg-green-700 text-white text-[10px] font-medium rounded transition-colors"
          >
            <Sparkles className="w-2.5 h-2.5" />
            使用
          </button>
        </div>
      </div>
    );
  }

  // Idle — show call-to-action
  return (
    <div id="prompt-panel" role="tabpanel" className="text-center py-4">
      <Wand2 className="w-6 h-6 text-zinc-300 dark:text-zinc-600 mx-auto mb-1.5" />
      <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mb-2">
        タスク説明をAIエージェント向けに最適化
      </p>
      <button
        onClick={onGeneratePrompt}
        className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-medium rounded-lg transition-colors"
      >
        <Sparkles className="w-3 h-3" />
        プロンプト生成
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal sub-component
// ---------------------------------------------------------------------------

type ClarificationQuestionsViewProps = {
  questions: PromptClarificationQuestion[];
  score: number;
  questionAnswers: Record<string, string>;
  isSubmittingAnswers: boolean;
  onSetQuestionAnswer: (id: string, value: string) => void;
  onCancel: () => void;
  onSubmit: () => Promise<void>;
  getCategoryLabel: (category: string) => string;
};

/**
 * Clarification questions form shown when the AI needs more information.
 * Supports both free-text and multiple-choice question types.
 *
 * @param props.questions - List of clarification questions from the API.
 * @param props.onSubmit - Sends answers back to regenerate the optimized prompt.
 */
function ClarificationQuestionsView({
  questions,
  score,
  questionAnswers,
  isSubmittingAnswers,
  onSetQuestionAnswer,
  onCancel,
  onSubmit,
  getCategoryLabel,
}: ClarificationQuestionsViewProps) {
  return (
    <div id="prompt-panel" role="tabpanel" className="space-y-3">
      <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
        <HelpCircle className="w-3.5 h-3.5" />
        <span className="text-[11px] font-medium">追加情報が必要です</span>
      </div>
      <div className="text-[10px] text-zinc-500 dark:text-zinc-400 mb-2">
        スコア: {score}/100 - より良いプロンプトを生成するために回答してください
      </div>
      <div className="space-y-2.5 max-h-48 overflow-y-auto">
        {questions.map((q) => (
          <div key={q.id} className="space-y-1">
            <div className="flex items-start gap-1.5">
              <span className="text-[10px] text-zinc-700 dark:text-zinc-300 flex-1">
                {q.question}
                {q.isRequired && <span className="text-red-500 ml-0.5">*</span>}
              </span>
              <span className="text-[9px] px-1 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 rounded shrink-0">
                {getCategoryLabel(q.category)}
              </span>
            </div>
            {q.options && q.options.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {q.options.map((option, i) => (
                  <button
                    key={i}
                    onClick={() => onSetQuestionAnswer(q.id, option)}
                    className={`px-2 py-0.5 text-[9px] rounded border transition-colors ${
                      questionAnswers[q.id] === option
                        ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                        : 'border-zinc-200 dark:border-zinc-700 hover:border-amber-300'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            ) : (
              <input
                type="text"
                value={questionAnswers[q.id] || ''}
                onChange={(e) => onSetQuestionAnswer(q.id, e.target.value)}
                placeholder="回答を入力..."
                className="w-full px-2 py-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-[10px] focus:outline-none focus:ring-1 focus:ring-amber-500/30 focus:border-amber-500"
              />
            )}
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-1.5 pt-1">
        <button
          onClick={onCancel}
          className="text-[10px] text-zinc-500 hover:text-zinc-700 px-2 py-1"
        >
          キャンセル
        </button>
        <button
          onClick={onSubmit}
          disabled={isSubmittingAnswers}
          className="flex items-center gap-1 px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-medium rounded transition-colors disabled:opacity-50"
        >
          {isSubmittingAnswers ? (
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
          ) : (
            <Send className="w-2.5 h-2.5" />
          )}
          回答を送信
        </button>
      </div>
    </div>
  );
}
