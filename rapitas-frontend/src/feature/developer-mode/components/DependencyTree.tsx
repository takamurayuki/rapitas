'use client';

/**
 * DependencyTree
 *
 * Developer-mode panel analysing subtask file dependencies for a given task.
 * Supports SSE streaming (default) with a REST fallback, and three view modes.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  GitBranch,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { useSSE } from '@/hooks/common/useSse';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import {
  RetryPanel,
  RollbackPanel,
  LoadingPanel,
  ErrorPanel,
} from './dependency-tree/DependencyStatusPanels';
import {
  TreeView,
  ListView,
  GroupsView,
  SummaryStats,
} from './dependency-tree/DependencyViews';
import type { AnalysisResult } from './dependency-tree/types';

const logger = createLogger('DependencyTree');

type Props = {
  taskId: number;
};

export function DependencyTree({ taskId }: Props) {
  const [expandedNodes, setExpandedNodes] = useState<Set<number>>(new Set());
  const [viewMode, setViewMode] = useState<'tree' | 'list' | 'groups'>('tree');
  const [useSSEMode, setUseSSEMode] = useState(true);

  const {
    isLoading,
    progress,
    progressMessage: _progressMessage,
    data: sseData,
    error: sseError,
    retryInfo,
    rollbackInfo,
    connect,
    reset,
  } = useSSE<AnalysisResult>({
    onComplete: () => {
      logger.info('SSE analysis completed');
    },
    onError: (error) => {
      logger.error('SSE error:', error);
    },
    onRetry: (info) => {
      logger.debug('Retrying:', info);
    },
    onRollback: (info) => {
      logger.debug('Rollback:', info);
    },
  });

  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [isLoadingFallback, setIsLoadingFallback] = useState(false);
  const [errorFallback, setErrorFallback] = useState<string | null>(null);

  const startSSEAnalysis = useCallback(() => {
    reset();
    connect(`${API_BASE_URL}/tasks/${taskId}/dependency-analysis/stream`);
  }, [taskId, connect, reset]);

  const fetchAnalysisFallback = useCallback(async () => {
    setIsLoadingFallback(true);
    setErrorFallback(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/tasks/${taskId}/dependency-analysis`,
      );
      if (res.ok) {
        const data = await res.json();
        setAnalysis(data);
      } else {
        const errData = await res.json();
        throw new Error(errData.error || 'Analysis failed');
      }
    } catch (err) {
      setErrorFallback(
        err instanceof Error ? err.message : 'An error occurred',
      );
    } finally {
      setIsLoadingFallback(false);
    }
  }, [taskId]);

  useEffect(() => {
    if (useSSEMode) {
      startSSEAnalysis();
    } else {
      fetchAnalysisFallback();
    }
  }, [useSSEMode, startSSEAnalysis, fetchAnalysisFallback]);

  const toggleNode = (nodeId: number) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const currentAnalysis = useSSEMode ? sseData : analysis;
  const currentIsLoading = useSSEMode ? isLoading : isLoadingFallback;
  const currentError = useSSEMode
    ? sseError
    : errorFallback
      ? { error: errorFallback }
      : null;

  const expandAll = () => {
    if (currentAnalysis) {
      setExpandedNodes(new Set(currentAnalysis.analysis.map((a) => a.taskId)));
    }
  };

  const collapseAll = () => setExpandedNodes(new Set());

  const switchToNormal = () => {
    setUseSSEMode(false);
    reset();
  };

  if (retryInfo && isLoading) {
    return (
      <RetryPanel
        retryCount={retryInfo.retryCount}
        maxRetries={retryInfo.maxRetries}
        reason={retryInfo.reason}
      />
    );
  }

  if (rollbackInfo) {
    return (
      <RollbackPanel
        rollbackReason={rollbackInfo.rollbackReason}
        errorDetails={rollbackInfo.errorDetails}
        onRetry={startSSEAnalysis}
        onSwitchToNormal={switchToNormal}
      />
    );
  }

  if (currentIsLoading) {
    return <LoadingPanel useSSEMode={useSSEMode} progress={progress} />;
  }

  if (currentError) {
    return (
      <ErrorPanel
        errorMessage={currentError.error}
        useSSEMode={useSSEMode}
        onRetry={useSSEMode ? startSSEAnalysis : fetchAnalysisFallback}
        onSwitchToNormal={switchToNormal}
      />
    );
  }

  if (!currentAnalysis) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="w-5 h-5 text-violet-600 dark:text-violet-400" />
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            Dependency Analysis
          </span>
          {useSSEMode && (
            <span className="px-1.5 py-0.5 bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 text-xs rounded">
              SSE
            </span>
          )}
        </div>
        <button
          onClick={useSSEMode ? startSSEAnalysis : fetchAnalysisFallback}
          disabled={currentIsLoading}
          className="p-1.5 text-zinc-400 hover:text-zinc-600 rounded"
          title="Refresh"
        >
          <RefreshCw
            className={`w-4 h-4 ${currentIsLoading ? 'animate-spin' : ''}`}
          />
        </button>
      </div>

      <SummaryStats summary={currentAnalysis.summary} />

      {/* View mode tabs */}
      <div className="flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-700">
        {(['tree', 'list', 'groups'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className={`px-3 py-2 text-sm font-medium transition-colors capitalize ${
              viewMode === mode
                ? 'text-violet-600 dark:text-violet-400 border-b-2 border-violet-600'
                : 'text-zinc-500 hover:text-zinc-700'
            }`}
          >
            {mode === 'tree'
              ? 'Tree View'
              : mode === 'list'
                ? 'List View'
                : 'Group View'}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={expandAll}
          className="text-xs text-zinc-500 hover:text-zinc-700"
        >
          Expand All
        </button>
        <button
          onClick={collapseAll}
          className="text-xs text-zinc-500 hover:text-zinc-700"
        >
          Collapse All
        </button>
      </div>

      <div className="max-h-96 overflow-y-auto">
        {viewMode === 'tree' && (
          <TreeView
            nodes={currentAnalysis.tree}
            expandedNodes={expandedNodes}
            onToggle={toggleNode}
          />
        )}
        {viewMode === 'list' && (
          <ListView analysis={currentAnalysis.analysis} />
        )}
        {viewMode === 'groups' && (
          <GroupsView parallelGroups={currentAnalysis.parallelGroups} />
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 pt-3 border-t border-zinc-200 dark:border-zinc-700 text-xs text-zinc-500">
        <div className="flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3 text-green-500" />
          <span>Parallel execution</span>
        </div>
        <div className="flex items-center gap-1">
          <AlertTriangle className="w-3 h-3 text-amber-500" />
          <span>Has dependencies</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-600 rounded">
            80%+
          </span>
          <span>High independence</span>
        </div>
      </div>
    </div>
  );
}
