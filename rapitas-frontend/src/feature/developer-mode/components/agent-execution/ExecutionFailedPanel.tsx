'use client';
// ExecutionFailedPanel

import React from 'react';
import { Play, AlertCircle, RefreshCw, Zap } from 'lucide-react';
import { formatTokenCount } from './useAgentExecution';

type Props = {
  /** Error message to display. */
  errorMessage: string;
  /** Total tokens used before the failure. */
  pollingTokensUsed: number | undefined;
  /** Whether a new execution is in progress (disables retry button). */
  isExecuting: boolean;
  /** Rendered log panel (passed from parent). */
  logsNode: React.ReactNode;
  /** Reset the panel to idle. */
  onReset: () => void;
  /** Re-run the execution. */
  onRetry: () => void;
};

/**
 * Panel shown after an execution fails.
 *
 * @param props - See Props type
 */
export function ExecutionFailedPanel({
  errorMessage,
  pollingTokensUsed,
  isExecuting,
  logsNode,
  onReset,
  onRetry,
}: Props) {
  return (
    <>
      <div className="bg-linear-to-r from-red-50 to-rose-50 dark:from-red-950/30 dark:to-rose-950/30 rounded-xl border border-red-200 dark:border-red-800 overflow-hidden">
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-red-100 dark:bg-red-900/40 rounded-xl">
              <AlertCircle className="w-8 h-8 text-red-600 dark:text-red-400" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-lg text-red-700 dark:text-red-300">
                実行に失敗しました
              </h3>
              <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                {errorMessage}
              </p>
              {(pollingTokensUsed ?? 0) > 0 && (
                <div className="flex items-center gap-1.5 mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                  <Zap className="w-3.5 h-3.5" />
                  <span>{formatTokenCount(pollingTokensUsed ?? 0)}</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onReset}
                className="flex items-center gap-2 px-4 py-2.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg font-medium transition-colors border border-zinc-300 dark:border-zinc-600"
              >
                <RefreshCw className="w-4 h-4" />
                リセット
              </button>
              <button
                onClick={onRetry}
                disabled={isExecuting}
                className="flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Play className="w-4 h-4" />
                再実行
              </button>
            </div>
          </div>
        </div>

        <div className="px-6 py-3 bg-red-100/50 dark:bg-red-900/20 border-t border-red-200 dark:border-red-800">
          {logsNode}
        </div>
      </div>
    </>
  );
}
