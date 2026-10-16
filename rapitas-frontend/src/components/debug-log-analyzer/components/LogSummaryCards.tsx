/**
 * LogSummaryCards
 *
 * Renders the four KPI cards at the top of the log analysis view:
 * total entries, error count, warning count, and time range.
 */

import React from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import { Activity, AlertCircle, AlertTriangle, Clock } from 'lucide-react';
import type { LogAnalysisResult } from '@/types/debug-log';

interface LogSummaryCardsProps {
  summary: LogAnalysisResult['summary'];
}

/**
 * Displays high-level log statistics as a responsive 4-column card grid.
 *
 * @param summary - Aggregated summary data from the log analysis result / ログ解析結果のサマリーデータ
 */
export const LogSummaryCards: React.FC<LogSummaryCardsProps> = ({ summary }) => {
  const t = useTranslations('devTools');
  const durationMinutes = summary.timeRange
    ? Math.round((summary.timeRange.end.getTime() - summary.timeRange.start.getTime()) / 1000 / 60)
    : null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      {/* Total entries */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t('debugLogAnalyzer.summaryCards.totalEntries')}
              </p>
              <p className="text-2xl font-bold">{summary.totalEntries}</p>
            </div>
            <Activity className="w-8 h-8 text-gray-400" />
          </div>
        </CardContent>
      </Card>

      {/* Error count */}
      <Card className={summary.errorCount > 0 ? 'border-red-500' : ''}>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t('debugLogAnalyzer.summaryCards.errorCount')}
              </p>
              <p className="text-2xl font-bold text-red-500">{summary.errorCount}</p>
            </div>
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
        </CardContent>
      </Card>

      {/* Warning count */}
      <Card className={summary.warningCount > 0 ? 'border-yellow-500' : ''}>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t('debugLogAnalyzer.summaryCards.warningCount')}
              </p>
              <p className="text-2xl font-bold text-yellow-500">{summary.warningCount}</p>
            </div>
            <AlertTriangle className="w-8 h-8 text-yellow-500" />
          </div>
        </CardContent>
      </Card>

      {/* Time range */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t('debugLogAnalyzer.summaryCards.timeRange')}
              </p>
              <p className="text-sm font-medium">
                {durationMinutes !== null
                  ? t('debugLogAnalyzer.summaryCards.minutes', { count: durationMinutes })
                  : t('debugLogAnalyzer.summaryCards.notAvailable')}
              </p>
            </div>
            <Clock className="w-8 h-8 text-gray-400" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
