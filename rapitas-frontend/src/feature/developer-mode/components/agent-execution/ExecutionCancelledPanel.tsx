'use client';
// ExecutionCancelledPanel

import React from 'react';
import { Square, RefreshCw, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { formatTokenCount } from './useAgentExecution';
import { formatCostUsd } from './agent-execution-utils';

type Props = {
  /** Total tokens used before cancellation. */
  pollingTokensUsed: number | undefined;
  /** Accumulated AI cost (USD) across the whole session. */
  pollingTotalSessionCostUsd: number | undefined;
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
  pollingTotalSessionCostUsd,
  logsNode,
  onReset,
}: Props) {
  const t = useTranslations('devMode.executionCancelledPanel');
  return (
    <>
      <div className="bg-linear-to-r from-yellow-50 to-amber-50 dark:from-yellow-950/30 dark:to-amber-950/30 rounded-xl border border-yellow-200 dark:border-yellow-800 overflow-hidden">
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-yellow-100 dark:bg-yellow-900/40 rounded-xl">
              <Square className="w-8 h-8 text-yellow-600 dark:text-yellow-400" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-lg text-zinc-900 dark:text-zinc-50">{t('title')}</h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">{t('message')}</p>
              {(pollingTokensUsed ?? 0) > 0 && (
                <div className="flex items-center gap-3 mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                  <span className="flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" />
                    {formatTokenCount(pollingTokensUsed ?? 0)}
                  </span>
                  {(pollingTotalSessionCostUsd ?? 0) > 0 && (
                    <span>{formatCostUsd(pollingTotalSessionCostUsd ?? 0)}</span>
                  )}
                </div>
              )}
            </div>
            <button
              onClick={onReset}
              className="flex items-center gap-2 px-4 py-2.5 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg font-medium transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              {t('rerun')}
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
