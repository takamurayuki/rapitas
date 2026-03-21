/**
 * ErrorAnalysisPanel
 *
 * Developer-mode dashboard for real-time error detection and analysis.
 * Owns all state and data-fetching; delegates rendering to sub-components
 * in the error-analysis/ subdirectory.
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { FlaskConical } from 'lucide-react';
import {
  errorAnalysisService,
  ErrorAnalysis,
  ErrorCategory,
  ErrorSeverity,
  ErrorSummary,
} from '../services/error-analysis-service';
import { Task, AgentSession } from '@/types';
import { ErrorSummaryCards } from './error-analysis/ErrorSummaryCards';
import { ErrorTrendsChart } from './error-analysis/ErrorTrendsChart';
import { ErrorFilters } from './error-analysis/ErrorFilters';
import { ErrorList } from './error-analysis/ErrorList';

// NOTE: categoryColors is re-exported here so it remains accessible to any
// sibling files that import it directly from this module.
const categoryColors = {
  [ErrorCategory.SYNTAX]: 'bg-purple-500',
  [ErrorCategory.RUNTIME]: 'bg-red-500',
  [ErrorCategory.NETWORK]: 'bg-blue-500',
  [ErrorCategory.PERMISSION]: 'bg-orange-500',
  [ErrorCategory.CONFIGURATION]: 'bg-green-500',
  [ErrorCategory.DEPENDENCY]: 'bg-indigo-500',
  [ErrorCategory.DATABASE]: 'bg-pink-500',
  [ErrorCategory.API]: 'bg-cyan-500',
  [ErrorCategory.VALIDATION]: 'bg-yellow-500',
  [ErrorCategory.TIMEOUT]: 'bg-gray-500',
  [ErrorCategory.UNKNOWN]: 'bg-gray-400',
};

export interface ErrorAnalysisPanelProps {
  currentTask?: Task;
  currentAgent?: AgentSession;
  onErrorSelect?: (error: ErrorAnalysis) => void;
}

/**
 * Full error analysis dashboard panel.
 *
 * @param props - See ErrorAnalysisPanelProps
 * @returns Dashboard with summary cards, trend chart, filters, common errors, and list.
 */
export const ErrorAnalysisPanel: React.FC<ErrorAnalysisPanelProps> = ({
  currentTask,
  currentAgent,
  onErrorSelect,
}) => {
  const [errors, setErrors] = useState<ErrorAnalysis[]>([]);
  const [summary, setSummary] = useState<ErrorSummary | null>(null);
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ErrorCategory | 'all'>('all');
  const [selectedSeverity, setSelectedSeverity] = useState<ErrorSeverity | 'all'>('all');
  const [isAutoRefresh, setIsAutoRefresh] = useState(true);

  // Simulate error detection from failed agent sessions
  useEffect(() => {
    if (!isAutoRefresh) return;

    const interval = setInterval(() => {
      // NOTE: In a real implementation this would capture actual console errors.
      // Currently it synthesizes errors from agent failure state.
      if (currentAgent?.status === 'failed') {
        const error = errorAnalysisService.analyzeError(
          currentAgent?.errorMessage || 'Unknown error occurred',
          { task: currentTask, agent: currentAgent },
        );
        setErrors((prev) => [error, ...prev].slice(0, 100));
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [currentTask, currentAgent, isAutoRefresh]);

  // Periodic summary refresh — empty deps intentional (mount/unmount only)
  useEffect(() => {
    const updateSummary = () => setSummary(errorAnalysisService.getErrorSummary());
    updateSummary();
    const interval = setInterval(updateSummary, 5000);
    return () => clearInterval(interval);
  }, []); // NOTE: deps left empty — summary should refresh on its own timer, not on prop changes

  const refreshSummary = useCallback(() => {
    setSummary(errorAnalysisService.getErrorSummary());
  }, []);

  const toggleErrorExpansion = (errorId: string) => {
    setExpandedErrors((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(errorId)) {
        newSet.delete(errorId);
      } else {
        newSet.add(errorId);
      }
      return newSet;
    });
  };

  const filteredErrors = errors.filter((error) => {
    const matchesSearch = searchQuery
      ? error.message.toLowerCase().includes(searchQuery.toLowerCase())
      : true;
    const matchesCategory =
      selectedCategory === 'all' || error.category === selectedCategory;
    const matchesSeverity =
      selectedSeverity === 'all' || error.severity === selectedSeverity;
    return matchesSearch && matchesCategory && matchesSeverity;
  });

  const exportErrorLog = () => {
    const logData = errorAnalysisService.exportErrorLog();
    const blob = new Blob([logData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `error-log-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!summary) return null;

  return (
    <div className="space-y-6">
      {/* Header with demo link */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">エラー解析ダッシュボード</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            リアルタイムでエラーを検出し、解決策を提案します
          </p>
        </div>
        <a
          href="/settings/developer-mode/error-demo"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-lg hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors"
        >
          <FlaskConical className="h-4 w-4" />
          エラーデモを試す
        </a>
      </div>

      <ErrorSummaryCards summary={summary} />

      <ErrorTrendsChart summary={summary} />

      <ErrorFilters
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedCategory={selectedCategory}
        onCategoryChange={setSelectedCategory}
        selectedSeverity={selectedSeverity}
        onSeverityChange={setSelectedSeverity}
        isAutoRefresh={isAutoRefresh}
        onToggleAutoRefresh={() => setIsAutoRefresh(!isAutoRefresh)}
        onExport={exportErrorLog}
      />

      {/* Most common errors */}
      <div className="p-6 rounded-lg border dark:bg-gray-800 dark:border-gray-700">
        <h3 className="text-lg font-semibold mb-4">Most Common Errors</h3>
        <div className="space-y-3">
          {summary.mostCommonErrors.map((error, index) => (
            <div key={index} className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Badge className={`${categoryColors[error.category]} text-white`}>
                  {error.category}
                </Badge>
                <span className="text-sm">{error.message}</span>
              </div>
              <span className="text-sm font-semibold">{error.count} times</span>
            </div>
          ))}
        </div>
      </div>

      <ErrorList
        errors={filteredErrors}
        expandedErrors={expandedErrors}
        onToggleExpansion={toggleErrorExpansion}
        onErrorSelect={onErrorSelect}
      />
    </div>
  );
};
