'use client';
/**
 * WorkflowQuestionPanel
 *
 * Interactive Q&A for a pending agent question, rendered in the workflow Q&A
 * tab (relocated from the execution log). Self-contained and presentational:
 * it manages only its own selection / free-text state and reports the answer
 * via onAnswer — the parent performs the POST. Multiple-choice is the default
 * (synthesized yes/no when the agent asked free-text); free-text entry stays
 * available for specific user-directed answers.
 */
import React, { useEffect, useState } from 'react';
import { HelpCircle, Send, Loader2, Clock } from 'lucide-react';
import type { LiveQuestion } from '@/stores/execution-state-store';
import { resolveQuestionOptions, secondsUntil } from './workflow-question-utils';

interface WorkflowQuestionPanelProps {
  /** The pending question to answer. */
  question: LiveQuestion;
  /** Whether an answer submission is in flight. */
  submitting: boolean;
  /** Submit the chosen/typed answer. */
  onAnswer: (answer: string) => void;
}

/**
 * Renders the pending question with selectable options + a free-text fallback.
 *
 * @param props - See {@link WorkflowQuestionPanelProps}.
 */
export function WorkflowQuestionPanel({
  question,
  submitting,
  onAnswer,
}: WorkflowQuestionPanelProps) {
  const { options, isDefault } = resolveQuestionOptions(question.options);
  const [selected, setSelected] = useState<string>('');
  const [freeText, setFreeText] = useState<string>('');
  const [remaining, setRemaining] = useState<number | null>(
    secondsUntil(question.timeoutDeadline, Date.now()),
  );

  // Reset local state when the question itself changes (next question arrives).
  useEffect(() => {
    setSelected('');
    setFreeText('');
  }, [question.text]);

  // Tick the auto-continue countdown once per second.
  useEffect(() => {
    if (!question.timeoutDeadline) {
      setRemaining(null);
      return;
    }
    const tick = () => setRemaining(secondsUntil(question.timeoutDeadline, Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [question.timeoutDeadline]);

  const answer = (freeText.trim() || selected).trim();
  const canSubmit = answer.length > 0 && !submitting;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
      <div className="mb-3 flex items-center gap-2">
        <div className="rounded-lg bg-amber-100 p-1.5 dark:bg-amber-900/40">
          <HelpCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        </div>
        <h4 className="text-sm font-medium text-amber-800 dark:text-amber-200">
          AIエージェントからの質問
        </h4>
        {question.confirmed && (
          <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700 dark:bg-green-900/40 dark:text-green-300">
            確認済み
          </span>
        )}
      </div>

      <p className="mb-3 whitespace-pre-wrap rounded-lg bg-white/60 p-3 text-sm text-amber-900 dark:bg-zinc-800/60 dark:text-amber-100">
        {question.text}
      </p>

      <div className="grid gap-2">
        {options.map((option, index) => {
          const key = String.fromCharCode(65 + index); // A, B, C, D
          const isSel = selected === option && !freeText.trim();
          return (
            <button
              key={index}
              type="button"
              onClick={() => {
                setSelected(option);
                setFreeText('');
              }}
              className={`rounded-lg border-2 px-4 py-3 text-left transition-all ${
                isSel
                  ? 'border-amber-500 bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100'
                  : 'border-zinc-300 bg-white text-zinc-700 hover:border-amber-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    isSel
                      ? 'bg-amber-500 text-white'
                      : 'bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400'
                  }`}
                >
                  {key}
                </span>
                <span className="flex-1 text-sm">{option}</span>
              </div>
            </button>
          );
        })}
      </div>

      {isDefault && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          ※
          選択肢が提示されなかったため既定の選択肢を表示しています。下の入力欄で自由に回答することもできます。
        </p>
      )}

      {remaining !== null && remaining > 0 && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-700 dark:bg-blue-900/30">
          <Clock className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <span className="text-sm text-blue-700 dark:text-blue-300">
            回答がない場合、約 <span className="font-mono font-medium">{remaining}</span>{' '}
            秒後に自動的に続行します。
          </span>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <input
          type="text"
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && canSubmit && onAnswer(answer)}
          placeholder="自由記述で回答する場合はこちらに入力..."
          className="flex-1 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30 dark:border-amber-700 dark:bg-zinc-800"
        />
        <button
          type="button"
          onClick={() => canSubmit && onAnswer(answer)}
          disabled={!canSubmit}
          className="flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 font-medium text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          送信
        </button>
      </div>
    </div>
  );
}

export default WorkflowQuestionPanel;
