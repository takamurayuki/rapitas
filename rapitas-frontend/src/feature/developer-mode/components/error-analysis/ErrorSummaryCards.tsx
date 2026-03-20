/**
 * ErrorSummaryCards
 *
 * Renders the four KPI cards at the top of the error analysis dashboard:
 * total errors, critical issues, error rate, and resolution rate.
 */

'use client';

import React from 'react';
import { Card } from '@/components/ui/card';
import { AlertCircle, XCircle, TrendingUp, CheckCircle } from 'lucide-react';
import { ErrorSeverity, ErrorSummary } from '../../services/errorAnalysisService';

type ErrorSummaryCardsProps = {
  /** Aggregated error statistics from errorAnalysisService. */
  summary: ErrorSummary;
};

/**
 * Grid of four summary stat cards for the error dashboard.
 *
 * @param props - See ErrorSummaryCardsProps
 * @returns A responsive 4-column grid of metric cards.
 */
export function ErrorSummaryCards({ summary }: ErrorSummaryCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">Total Errors</p>
            <p className="text-2xl font-bold">{summary.totalErrors}</p>
          </div>
          <div className="p-2 bg-red-100 dark:bg-red-900/20 rounded-lg">
            <AlertCircle className="h-6 w-6 text-red-500" />
          </div>
        </div>
      </Card>

      <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">Critical Issues</p>
            <p className="text-2xl font-bold">
              {summary.errorsBySeverity[ErrorSeverity.CRITICAL] || 0}
            </p>
          </div>
          <div className="p-2 bg-red-100 dark:bg-red-900/20 rounded-lg">
            <XCircle className="h-6 w-6 text-red-500" />
          </div>
        </div>
      </Card>

      <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">Error Rate</p>
            <div className="flex items-center space-x-1">
              <p className="text-2xl font-bold">
                {summary.errorTrends[summary.errorTrends.length - 1]?.count || 0}
              </p>
              <span className="text-sm text-gray-500">/hr</span>
            </div>
          </div>
          <div className="p-2 bg-blue-100 dark:bg-blue-900/20 rounded-lg">
            <TrendingUp className="h-6 w-6 text-blue-500" />
          </div>
        </div>
      </Card>

      <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">Resolution Rate</p>
            {/* NOTE: Resolution rate is hardcoded at 87% — no dynamic data source yet. */}
            <p className="text-2xl font-bold">87%</p>
          </div>
          <div className="p-2 bg-green-100 dark:bg-green-900/20 rounded-lg">
            <CheckCircle className="h-6 w-6 text-green-500" />
          </div>
        </div>
      </Card>
    </div>
  );
}
