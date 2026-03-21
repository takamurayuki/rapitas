/**
 * ErrorTrendsChart
 *
 * Bar chart visualization showing error counts over the last 24 hours.
 * Each bar represents one time-bucket from ErrorSummary.errorTrends.
 */

'use client';

import React from 'react';
import { Card } from '@/components/ui/card';
import { ErrorSummary } from '../../services/error-analysis-service';

type ErrorTrendsChartProps = {
  /** Trend data from errorAnalysisService.getErrorSummary(). */
  summary: ErrorSummary;
};

/**
 * Simple bar chart of error trends over the last 24 hours.
 *
 * @param props - See ErrorTrendsChartProps
 * @returns Card with an inline bar chart built from flex divs.
 */
export function ErrorTrendsChart({ summary }: ErrorTrendsChartProps) {
  const maxCount = Math.max(...summary.errorTrends.map((t) => t.count));

  return (
    <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
      <h3 className="text-lg font-semibold mb-4">Error Trends (Last 24 Hours)</h3>
      <div className="h-32 flex items-end space-x-1">
        {summary.errorTrends.map((trend, index) => (
          <div
            key={index}
            className="flex-1 bg-blue-500 dark:bg-blue-600 rounded-t hover:bg-blue-600 dark:hover:bg-blue-700 transition-colors"
            style={{
              height: `${Math.max(5, (trend.count / maxCount) * 100)}%`,
            }}
            title={`${trend.timestamp.toLocaleTimeString()}: ${trend.count} errors`}
          />
        ))}
      </div>
    </Card>
  );
}
