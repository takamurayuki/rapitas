/**
 * ClarificationQuestionsView
 *
 * Renders the clarification questions form shown when the AI requests
 * additional information before generating the final optimized prompt.
 */

'use client';

import { Loader2, MessageSquare, HelpCircle, Send } from 'lucide-react';
import type { PromptClarificationQuestion } from './prompt-optimization-types';
import { getCategoryLabel, getCategoryColor } from './prompt-optimization-types';

type Props = {
  questions: PromptClarificationQuestion[];
  answers: Record<string, string>;
  isSubmitting: boolean;
  onAnswerChange: (id: string, value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  className?: string;
};

/**
 * Form for answering AI clarification questions prior to prompt generation.
 *
 * @param props - ClarificationQuestionsView props
 */
export function ClarificationQuestionsView({
  questions,
  answers,
  isSubmitting,
  onAnswerChange,
  onSubmit,
  onCancel,
  className = '',
}: Props) {
  return (
    <div
      className={`bg-white dark:bg-indigo-dark-900 rounded-xl border border-amber-200 dark:border-amber-700 overflow-hidden ${className}`}
    >
      <div className="px-6 py-4 bg-linear-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border-b border-amber-200 dark:border-amber-700">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-100 dark:bg-amber-900/40 rounded-lg">
            <HelpCircle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">
              追加情報が必要です
            </h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              より良いプロンプトを生成するために、以下の質問に回答してください
            </p>
          </div>
        </div>
      </div>

      <div className="px-6 py-4 space-y-4">
        {questions.map((q) => (
          <div key={q.id} className="space-y-2">
            <div className="flex items-start gap-2">
              <MessageSquare className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-zinc-900 dark:text-zinc-50 text-sm">
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
                {q.options && q.options.length > 0 ? (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {q.options.map((option, i) => (
                      <button
                        key={i}
                        onClick={() => onAnswerChange(q.id, option)}
                        className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                          answers[q.id] === option
                            ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                            : 'border-zinc-200 dark:border-zinc-700 hover:border-amber-300 dark:hover:border-amber-600'
                        }`}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                ) : (
                  <input
                    type="text"
                    value={answers[q.id] || ''}
                    onChange={(e) => onAnswerChange(q.id, e.target.value)}
                    placeholder="回答を入力..."
                    className="w-full mt-1 px-3 py-2 bg-white dark:bg-indigo-dark-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                  />
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-amber-200 dark:border-amber-700">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
        >
          キャンセル
        </button>
        <button
          onClick={onSubmit}
          disabled={isSubmitting}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors disabled:opacity-50"
        >
          {isSubmitting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
          回答を送信
        </button>
      </div>
    </div>
  );
}
