'use client';
/**
 * AgentQuestionCard
 *
 * Claude WebUI-style card that walks the user through one or more agent
 * questions and submits the combined answer. Owns only the in-card step /
 * answer state; submission is delegated to the parent via callbacks.
 */

import { useState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Send } from 'lucide-react';

/** Structured question payload from the agent (single- or multi-question). */
export type AgentQuestionDetails = {
  options?: Array<{ label: string; description?: string }>;
  headers?: string[];
  multiSelect?: boolean;
  questions?: Array<{
    header?: string;
    question: string;
    options?: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }>;
} | null;

export type AgentQuestionCardProps = {
  question: string;
  questionDetails?: AgentQuestionDetails;
  userResponse: string;
  isSendingResponse: boolean;
  onSetUserResponse: (v: string) => void;
  onSendResponse: () => Promise<void>;
};

/**
 * Agent question card — Claude WebUI style.
 *
 * - Multi-question case: walks through one question at a time. Each
 *   question shows its own options (if any) and a free-text input that's
 *   ALWAYS available so the user can type a custom answer instead of
 *   picking from preset options. After answering, "次へ" advances; on the
 *   last question "送信" submits all answers concatenated as one response.
 * - Single-question case: same UI, just one step.
 *
 * @param props - Question text/details and response callbacks / 質問内容と回答コールバック
 */
export function AgentQuestionCard({
  question,
  questionDetails,
  userResponse: _userResponse,
  isSendingResponse,
  onSetUserResponse,
  onSendResponse,
}: AgentQuestionCardProps) {
  const t = useTranslations('devMode.agentQuestionCard');
  const tCommon = useTranslations('common');
  const subQuestions = questionDetails?.questions;
  const hasMulti = !!subQuestions && subQuestions.length > 0;

  // Effective list of steps to walk through. Single-question fallback wraps
  // the legacy questionText + first-question options into one step.
  const steps = hasMulti
    ? subQuestions
    : [
        {
          header: questionDetails?.headers?.[0],
          question,
          options: questionDetails?.options,
          multiSelect: questionDetails?.multiSelect,
        },
      ];

  const [currentIndex, setCurrentIndex] = useState(0);
  // Per-step answers accumulated in this card; reset when the question
  // payload changes (new tool call from agent).
  const [answers, setAnswers] = useState<string[]>(() => steps.map(() => ''));
  const fingerprint = JSON.stringify(steps.map((s) => s.question));
  const lastFingerprintRef = useRef<string>(fingerprint);
  if (lastFingerprintRef.current !== fingerprint) {
    lastFingerprintRef.current = fingerprint;
    // schedule reset on next paint to avoid setState during render
    setTimeout(() => {
      setCurrentIndex(0);
      setAnswers(steps.map(() => ''));
    }, 0);
  }

  const step = steps[currentIndex];
  const isLast = currentIndex === steps.length - 1;
  const currentAnswer = answers[currentIndex] ?? '';
  const setCurrentAnswer = (v: string) => {
    setAnswers((prev) => {
      const next = [...prev];
      next[currentIndex] = v;
      return next;
    });
  };

  const submitAll = async (overrideLast?: string) => {
    const finalAnswers = [...answers];
    if (overrideLast !== undefined) finalAnswers[currentIndex] = overrideLast;
    // Build a structured combined response so the agent can map answers back
    // to the questions it asked.
    const combined = finalAnswers
      .map((a, i) => {
        const headerOrQ = steps[i].header ?? `Q${i + 1}`;
        return `${headerOrQ}: ${a.trim()}`;
      })
      .join('\n');
    onSetUserResponse(combined);
    setTimeout(() => onSendResponse(), 0);
  };

  const advance = (answer: string) => {
    setCurrentAnswer(answer);
    if (isLast) {
      void submitAll(answer);
    } else {
      setCurrentIndex((i) => i + 1);
    }
  };

  const handleOptionClick = (label: string) => {
    advance(label);
  };

  const handleNext = () => {
    if (!currentAnswer.trim()) return;
    advance(currentAnswer);
  };

  const goBack = () => {
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
  };

  const options = step.options;
  const hasOptions = !!options && options.length > 0;

  return (
    <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800 space-y-2">
      {/* Progress + header */}
      {hasMulti && (
        <div className="flex items-center justify-between text-[10px] text-amber-700 dark:text-amber-300">
          <span>{t('questionProgress', { current: currentIndex + 1, total: steps.length })}</span>
          <div className="flex gap-0.5">
            {steps.map((_, i) => (
              <span
                key={i}
                className={`h-1 w-4 rounded ${
                  i < currentIndex
                    ? 'bg-amber-500'
                    : i === currentIndex
                      ? 'bg-amber-400'
                      : 'bg-amber-200 dark:bg-amber-800'
                }`}
              />
            ))}
          </div>
        </div>
      )}

      {step.header && (
        <p className="text-[11px] font-semibold text-amber-900 dark:text-amber-100">
          {step.header}
        </p>
      )}
      <p className="text-[11px] text-amber-800 dark:text-amber-200 whitespace-pre-wrap">
        {step.question}
      </p>

      {/* Option buttons — shown when this step has options */}
      {hasOptions && (
        <div className="flex flex-wrap gap-1.5">
          {options.map((opt, i) => (
            <button
              key={i}
              onClick={() => handleOptionClick(opt.label)}
              disabled={isSendingResponse}
              className="flex flex-col items-start rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-left transition-colors hover:border-amber-500 hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-50"
            >
              <span className="text-[11px] font-medium text-amber-900 dark:text-amber-100">
                {opt.label}
              </span>
              {opt.description && (
                <span className="text-[9px] text-amber-600 dark:text-amber-400 line-clamp-1">
                  {opt.description}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Free-text input — always available alongside any options so the
          user can write a custom answer instead of picking a preset. */}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={currentAnswer}
          onChange={(e) => setCurrentAnswer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && currentAnswer.trim()) handleNext();
          }}
          placeholder={hasOptions ? t('freeTextPlaceholder') : t('answerPlaceholder')}
          className="flex-1 px-2 py-1 bg-white dark:bg-zinc-800 border border-amber-300 dark:border-amber-700 rounded text-[11px] focus:outline-none focus:ring-1 focus:ring-amber-500"
          autoFocus
          aria-label={t('answerAriaLabel')}
        />
        {currentIndex > 0 && (
          <button
            onClick={goBack}
            disabled={isSendingResponse}
            className="px-2 py-1 text-amber-700 dark:text-amber-300 text-[10px] hover:bg-amber-100 dark:hover:bg-amber-900/40 rounded"
          >
            {tCommon('back')}
          </button>
        )}
        <button
          onClick={handleNext}
          disabled={!currentAnswer.trim() || isSendingResponse}
          className="flex items-center gap-1 px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-medium rounded transition-colors disabled:opacity-50"
          aria-label={isLast ? t('submitAnswer') : t('nextQuestion')}
        >
          {isSendingResponse ? (
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
          ) : (
            <Send className="w-2.5 h-2.5" />
          )}
          {isLast ? t('submit') : t('next')}
        </button>
      </div>

      {/* Show a quick recap of answers given so far in multi-question mode */}
      {hasMulti && currentIndex > 0 && (
        <details className="text-[10px] text-amber-700 dark:text-amber-300">
          <summary className="cursor-pointer">{t('answersSoFar')}</summary>
          <ul className="mt-1 space-y-0.5 pl-3">
            {answers.slice(0, currentIndex).map((a, i) => (
              <li key={i} className="truncate">
                <span className="font-medium">{steps[i].header ?? `Q${i + 1}`}:</span>{' '}
                {a || <span className="italic">{t('unanswered')}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
