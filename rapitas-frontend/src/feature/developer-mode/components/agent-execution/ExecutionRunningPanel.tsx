'use client';
// ExecutionRunningPanel

import React from 'react';
import { Loader2, AlertCircle, Rocket, HelpCircle, Square, Send, Clock, Zap } from 'lucide-react';
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
  userResponse,
  setUserResponse,
  isSendingResponse,
  timeoutCountdown,
  pollingTokensUsed,
  logsNode,
  onStop,
  onSendResponse,
}: Props) {
  const showWaitingUI = isWaitingForInput && hasQuestion;

  return (
    <>
      <div
        className={`rounded-xl border overflow-hidden ${
          showWaitingUI
            ? 'bg-linear-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 border-amber-200 dark:border-amber-800'
            : 'bg-linear-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border-blue-200 dark:border-blue-800'
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
                  {showWaitingUI ? 'Claude Codeからの質問' : 'AI エージェント実行中'}
                </h3>
                {showWaitingUI && isConfirmedQuestion && (
                  <span className="px-2 py-0.5 text-xs bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded-full font-medium">
                    ツール呼び出し
                  </span>
                )}
                {showWaitingUI && !isConfirmedQuestion && (
                  <span className="px-2 py-0.5 text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded-full font-medium">
                    パターン検出
                  </span>
                )}
              </div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                {showWaitingUI
                  ? '以下の質問に回答してください。回答後、実行が継続されます。'
                  : 'Claude Codeがタスクの実行を進めています...'}
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
              停止
            </button>
          </div>
        </div>

        {hasQuestion && (
          <div
            className={`mx-6 mb-4 p-4 rounded-lg ${
              showWaitingUI
                ? 'bg-white/60 dark:bg-indigo-dark-900/40 border border-amber-200 dark:border-amber-700'
                : 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800'
            }`}
          >
            {!showWaitingUI && (
              <div className="flex items-start gap-3 mb-3">
                <div className="p-1.5 bg-amber-100 dark:bg-amber-900/40 rounded-lg shrink-0">
                  <HelpCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="flex-1 flex items-center gap-2">
                  <h4 className="font-medium text-amber-800 dark:text-amber-200 text-sm">
                    Claude Codeからの質問
                  </h4>
                  {isConfirmedQuestion && (
                    <span className="px-1.5 py-0.5 text-xs bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded">
                      確認済み
                    </span>
                  )}
                </div>
              </div>
            )}

            <div
              className={`mb-3 p-3 rounded-lg ${
                showWaitingUI
                  ? 'bg-amber-50 dark:bg-amber-900/30'
                  : 'bg-white/60 dark:bg-zinc-800/60'
              }`}
            >
              <p className="text-sm text-amber-800 dark:text-amber-200 font-mono whitespace-pre-wrap mb-3">
                {hasOptions ? questionParsed!.text : question}
              </p>

              {hasOptions && (
                <div className="grid gap-2 mt-4">
                  {questionParsed!.options.map((option, index) => {
                    const optionKey = String.fromCharCode(65 + index); // A, B, C, D
                    const isSelected = userResponse === option;

                    return (
                      <button
                        key={index}
                        onClick={() => setUserResponse(option)}
                        className={`text-left px-4 py-3 rounded-lg border-2 transition-all duration-200 ${
                          isSelected
                            ? 'border-amber-500 bg-amber-100 dark:bg-amber-900/50 text-amber-900 dark:text-amber-100'
                            : 'border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                              isSelected
                                ? 'bg-amber-500 text-white'
                                : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400'
                            }`}
                          >
                            {optionKey}
                          </span>
                          <span className="text-sm flex-1">{option}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {timeoutCountdown !== null && timeoutCountdown > 0 && (
              <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg">
                <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span className="text-sm text-blue-700 dark:text-blue-300">
                  回答がない場合、
                  <span className="font-mono font-medium">
                    {formatCountdown(timeoutCountdown)}
                  </span>{' '}
                  後に自動的に続行します。
                </span>
              </div>
            )}

            {timeoutCountdown !== null && timeoutCountdown > 0 && timeoutCountdown <= 30 && (
              <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-orange-50 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-700 rounded-lg animate-pulse">
                <AlertCircle className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                <span className="text-sm text-orange-700 dark:text-orange-300 font-medium">
                  まもなく自動的に続行します。
                </span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={userResponse}
                onChange={(e) => setUserResponse(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onSendResponse()}
                placeholder="回答を入力してEnterで送信..."
                className="flex-1 px-3 py-2 bg-white dark:bg-zinc-800 border border-amber-300 dark:border-amber-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                autoFocus={showWaitingUI}
              />
              <button
                onClick={onSendResponse}
                disabled={!userResponse.trim() || isSendingResponse}
                className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSendingResponse ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                送信
              </button>
            </div>
          </div>
        )}

        <div className="mx-6 mb-4">{logsNode}</div>
      </div>
    </>
  );
}
