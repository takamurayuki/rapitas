'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { fetchTestCorrelationDrilldown } from '../hooks/useTestCorrelationMatrix';
import type { FailureDrilldownEntry, RunSource } from '../test-correlation.types';

interface TestCorrelationDrilldownProps {
  changedFile: string;
  testFile: string;
  windowMonths?: number;
  onClose: () => void;
}

const SOURCE_LABEL_KEY: Record<RunSource, string> = {
  ci: 'sourceCi',
  local: 'sourceLocal',
  manual: 'sourceManual',
};

/**
 * Modal panel showing failure events for one correlation cell (受入条件4's drilldown).
 */
export function TestCorrelationDrilldown({
  changedFile,
  testFile,
  windowMonths = 3,
  onClose,
}: TestCorrelationDrilldownProps) {
  const t = useTranslations('testCorrelation.drilldown');
  const [entries, setEntries] = useState<FailureDrilldownEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchTestCorrelationDrilldown(changedFile, testFile, windowMonths).then((result) => {
      if (!cancelled) {
        setEntries(result);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [changedFile, testFile, windowMonths]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg p-4 w-96 max-h-[70vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            {t('title', { testFile })}
          </span>
          <button
            onClick={onClose}
            aria-label={t('close')}
            className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="animate-pulse space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-zinc-200 dark:bg-zinc-700 rounded" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="py-4 text-center text-sm text-zinc-500 dark:text-zinc-500">
            {t('empty')}
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => (
              <div
                key={entry.runId}
                className="p-2 rounded-lg border border-zinc-100 dark:border-zinc-700 text-xs space-y-0.5"
              >
                <p className="text-zinc-700 dark:text-zinc-300">
                  {t('runIdLabel', { runId: entry.runId })}
                </p>
                <p className="text-zinc-500 dark:text-zinc-400">
                  {t('commitLabel', { commitSha: entry.commitSha ?? '-' })}
                </p>
                <p className="text-zinc-500 dark:text-zinc-400">
                  {t('sourceLabel', { source: t(SOURCE_LABEL_KEY[entry.source]) })}
                </p>
                <p className="text-zinc-500 dark:text-zinc-400">
                  {t('environmentLabel', {
                    platform: entry.environment.platform,
                    runtimeVersion: entry.environment.runtimeVersion,
                  })}
                </p>
                {entry.failureTail && entry.failureTail.length > 0 ? (
                  <div>
                    <p className="text-zinc-500 dark:text-zinc-400">{t('failureTailLabel')}</p>
                    <pre
                      data-testid="failure-tail"
                      className="mt-1 p-2 rounded bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 overflow-x-auto max-h-40 overflow-y-auto whitespace-pre"
                    >
                      {entry.failureTail.join('\n')}
                    </pre>
                  </div>
                ) : (
                  <p className="text-zinc-400 dark:text-zinc-500 italic">{t('failureTailEmpty')}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
