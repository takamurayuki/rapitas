'use client';
// ExecutionRunningPanel

import React from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Rocket, HelpCircle, Square, Zap } from 'lucide-react';
import { formatTokenCount, formatCountdown } from './useAgentExecution';

type Props = {
  /** Whether the agent is waiting for a user answer (AskUserQuestion tool call). */
  isWaitingForInput: boolean;
  /** Whether a question was detected from the agent. */
  hasQuestion: boolean;
  /** The question text, if any. */
  question: string;
  /** Whether the question was confirmed via tool_call (not pattern match). */
  isConfirmedQuestion: boolean;
  /** Parsed question with multiple-choice options, if applicable. */
  questionParsed: { text: string; options: string[] } | null;
  /** Whether the parsed question has selectable options. */
  hasOptions: boolean;
  /** User's current response text. */
  userResponse: string;
  /** Update the user response text. */
  setUserResponse: (v: string) => void;
  /** Whether a response API call is in flight. */
  isSendingResponse: boolean;
  /** Remaining seconds before the question auto-continues, or null. */
  timeoutCountdown: number | null;
  /** Total tokens used in this session. */
  pollingTokensUsed: number | undefined;
  /** Rendered log panel (passed from parent to avoid prop-drilling ExecutionLogViewer). */
  logsNode: React.ReactNode;
  /** Stop the running execution. */
  onStop: () => void;
  /** Send the user's response to the agent. */
  onSendResponse: () => void;
};

/**
 * Panel shown while the agent is executing or waiting for user input.
 *
 * @param props - See Props type
 */
export function ExecutionRunningPanel({
  isWaitingForInput,
  hasQuestion,
  question,
  isConfirmedQuestion,
  questionParsed,
  hasOptions,
  timeoutCountdown,
  pollingTokensUsed,
  logsNode,
  onStop,
}: Props) {
  // NOTE: userResponse / setUserResponse / isSendingResponse / onSendResponse are
  // still accepted in Props (the parent passes them) but no longer used here —
  // the interactive Q&A was relocated to the workflow Q&A tab (集約).
  const t = useTranslations('devMode.executionRunningPanel');
  const showWaitingUI = isWaitingForInput && hasQuestion;

  return (
    <>
      <div
        className={`rounded-xl border overflow-hidden ${
          showWaitingUI
            ? 'bg-linear-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 border-amber-200 dark:border-amber-800'
            : 'bg-linear-to-r from-blue-50 to-blue-50 dark:from-blue-950/30 dark:to-blue-950/30 border-blue-200 dark:border-blue-800'
        }`}
      >
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="relative">
              <div
                className={`w-16 h-16 rounded-2xl flex items-center justify-center ${
                  showWaitingUI
                    ? 'bg-amber-100 dark:bg-amber-900/40'
                    : 'bg-blue-100 dark:bg-blue-900/40'
                }`}
              >
                {showWaitingUI ? (
                  <HelpCircle className="w-8 h-8 text-amber-600 dark:text-amber-400" />
                ) : (
                  <Rocket className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                )}
              </div>
              {!showWaitingUI && (
                <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-white dark:bg-indigo-dark-900 flex items-center justify-center shadow-lg">
                  <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                </div>
              )}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-lg text-zinc-900 dark:text-zinc-50">
                  {showWaitingUI ? t('questionTitle') : t('runningTitle')}
                </h3>
                {showWaitingUI && isConfirmedQuestion && (
                  <span className="px-2 py-0.5 text-xs bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded-full font-medium">
                    {t('toolCallBadge')}
                  </span>
                )}
                {showWaitingUI && !isConfirmedQuestion && (
                  <span className="px-2 py-0.5 text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded-full font-medium">
                    {t('patternDetectedBadge')}
                  </span>
                )}
              </div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                {showWaitingUI ? t('questionHint') : t('runningHint')}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between mt-4">
            {(pollingTokensUsed ?? 0) > 0 ? (
              <div className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
                <Zap className="w-3.5 h-3.5" />
                <span>{formatTokenCount(pollingTokensUsed ?? 0)}</span>
              </div>
            ) : (
              <div />
            )}
            <button
              onClick={onStop}
              className="flex items-center gap-2 px-4 py-2 bg-red-100 dark:bg-red-900/40 hover:bg-red-200 dark:hover:bg-red-800/50 text-red-700 dark:text-red-300 rounded-lg font-medium transition-colors"
            >
              <Square className="w-4 h-4" />
              {t('stop')}
            </button>
          </div>
        </div>

        {hasQuestion && (
          <div className="mx-6 mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
            <div className="mb-2 flex items-center gap-2">
              <div className="rounded-lg bg-amber-100 p-1.5 dark:bg-amber-900/40">
                <HelpCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
              <h4 className="text-sm font-medium text-amber-800 dark:text-amber-200">
                {t('agentQuestionHeading')}
              </h4>
              {isConfirmedQuestion && (
                <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700 dark:bg-green-900/40 dark:text-green-300">
                  {t('confirmedBadge')}
                </span>
              )}
            </div>
            {/* The interactive prompt was relocated to the workflow Q&A tab
                (集約). Show the question text + a pointer here. */}
            <p className="mb-2 whitespace-pre-wrap rounded-lg bg-white/60 p-3 font-mono text-sm text-amber-800 dark:bg-zinc-800/60 dark:text-amber-200">
              {hasOptions ? questionParsed!.text : question}
            </p>
            <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
              {t('qaTabPointer')}
              {timeoutCountdown !== null && timeoutCountdown > 0 && (
                <> {t('autoContinueNotice', { time: formatCountdown(timeoutCountdown) })}</>
              )}
            </p>
          </div>
        )}

        <div className="mx-6 mb-4">{logsNode}</div>
      </div>
    </>
  );
}
