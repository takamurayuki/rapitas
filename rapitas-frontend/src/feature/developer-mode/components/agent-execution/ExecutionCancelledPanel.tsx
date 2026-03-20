/**
 * ExecutionCancelledPanel
 *
 * Renders the UI shown when an agent execution has been cancelled by the user.
 * Does not manage any state; all values and callbacks are received via props.
 */

'use client';

import React from 'react';
import { Square, RefreshCw, Zap } from 'lucide-react';
import { formatTokenCount } from './useAgentExecution';

type Props = {
  /** Total tokens used before cancellation. */
  pollingTokensUsed: number | undefined;
  /** Rendered log panel (passed from parent). */
  logsNode: React.ReactNode;
  /** Reset the panel to allow re-execution. */
  onReset: () => void;
};

/**
 * Panel shown after the user cancels execution.
 *
 * @param props - See Props type
 */
export function ExecutionCancelledPanel({
  pollingTokensUsed,
  logsNode,
  onReset,
}: Props) {
  return (
    <>
      <div className="bg-linear-to-r from-yellow-50 to-amber-50 dark:from-yellow-950/30 dark:to-amber-950/30 rounded-xl border border-yellow-200 dark:border-yellow-800 overflow-hidden">
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-yellow-100 dark:bg-yellow-900/40 rounded-xl">
              <Square className="w-8 h-8 text-yellow-600 dark:text-yellow-400" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-lg text-zinc-900 dark:text-zinc-50">
                実行をキャンセルしました
              </h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                AIエージェントの実行がキャンセルされ、変更が元に戻されました。
              </p>
              {(pollingTokensUsed ?? 0) > 0 && (
                <div className="flex items-center gap-1.5 mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                  <Zap className="w-3.5 h-3.5" />
                  <span>{formatTokenCount(pollingTokensUsed ?? 0)}</span>
                </div>
              )}
            </div>
            <button
              onClick={onReset}
              className="flex items-center gap-2 px-4 py-2.5 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg font-medium transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              再実行
            </button>
          </div>
        </div>

        <div className="px-6 py-3 bg-yellow-100/50 dark:bg-yellow-900/20 border-t border-yellow-200 dark:border-yellow-800">
          {logsNode}
        </div>
      </div>
    </>
  );
}
