'use client';

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Terminal,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Square,
  Clock,
  Layers,
} from 'lucide-react';
import {
  ExecutionLogViewer,
  type ExecutionLogStatus,
} from './ExecutionLogViewer';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('TabbedExecutionLogViewer');
import type { ParallelExecutionStatus } from '@/feature/tasks/components/SubtaskExecutionStatus';

/**
 * Subtask info
 */
interface SubtaskInfo {
  id: number;
  title: string;
  status: ParallelExecutionStatus;
}

/**
 * TabbedExecutionLogViewer props
 */
export interface TabbedExecutionLogViewerProps {
  /** Parallel execution session ID */
  sessionId: string;
  /** List of subtasks */
  subtasks: SubtaskInfo[];
  /** Overall logs (for parent task) */
  overallLogs: string[];
  /** Overall status */
  overallStatus: ExecutionLogStatus;
  /** SSE connection state */
  isConnected?: boolean;
  /** Whether running */
  isRunning?: boolean;
  /** Max log height in pixels */
  maxHeight?: number;
  /** Custom class name */
  className?: string;
}

/**
 * Return icon based on status
 */
function getStatusIcon(status: ParallelExecutionStatus | ExecutionLogStatus) {
  switch (status) {
    case 'running':
      return <Loader2 className="w-3 h-3 animate-spin text-blue-400" />;
    case 'completed':
      return <CheckCircle2 className="w-3 h-3 text-green-400" />;
    case 'failed':
      return <AlertCircle className="w-3 h-3 text-red-400" />;
    case 'cancelled':
      return <Square className="w-3 h-3 text-yellow-400" />;
    case 'blocked':
      return <Clock className="w-3 h-3 text-orange-400" />;
    case 'pending':
    case 'scheduled':
      return <Clock className="w-3 h-3 text-zinc-400" />;
    default:
      return null;
  }
}

/**
 * Convert status to ExecutionLogStatus
 */
function toLogStatus(status: ParallelExecutionStatus): ExecutionLogStatus {
  switch (status) {
    case 'running':
    case 'scheduled':
      return 'running';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'idle';
  }
}

/**
 * TabbedExecutionLogViewer - Tabbed log viewer per subtask
 *
 * Displays logs for each subtask with tab switching during parallel execution.
 */
export const TabbedExecutionLogViewer: React.FC<
  TabbedExecutionLogViewerProps
> = ({
  sessionId,
  subtasks,
  overallLogs,
  overallStatus,
  isConnected = false,
  isRunning = false,
  maxHeight = 200,
  className = '',
}) => {
  // Selected tab (null = overall, number = subtask ID)
  const [selectedTab, setSelectedTab] = useState<number | null>(null);
  // Per-subtask log cache
  const [subtaskLogs, setSubtaskLogs] = useState<Record<number, string[]>>({});
  // Subtask ID currently being fetched
  const [loadingSubtaskId, setLoadingSubtaskId] = useState<number | null>(null);

  // Fetch subtask logs
  const fetchSubtaskLogs = useCallback(
    async (taskId: number) => {
      if (!sessionId || subtaskLogs[taskId]) return;

      setLoadingSubtaskId(taskId);
      try {
        const res = await fetch(
          `${API_BASE_URL}/parallel/sessions/${sessionId}/logs?taskId=${taskId}&limit=500`,
        );
        if (!res.ok) {
          throw new Error('ログの取得に失敗しました');
        }
        const result = await res.json();
        if (result.success && result.data) {
          const logs = result.data.map(
            (entry: { message: string; timestamp: string; level: string }) =>
              `[${entry.level.toUpperCase()}] ${entry.message}\n`,
          );
          setSubtaskLogs((prev) => ({
            ...prev,
            [taskId]: logs,
          }));
        }
      } catch (err) {
        logger.error(`Failed to fetch logs for task ${taskId}:`, err);
      } finally {
        setLoadingSubtaskId(null);
      }
    },
    [sessionId, subtaskLogs],
  );

  // Fetch logs on tab selection
  useEffect(() => {
    if (selectedTab !== null && !subtaskLogs[selectedTab]) {
      fetchSubtaskLogs(selectedTab);
    }
  }, [selectedTab, subtaskLogs, fetchSubtaskLogs]);

  // Currently selected logs and status
  const currentLogs = useMemo(() => {
    if (selectedTab === null) {
      return overallLogs;
    }
    return subtaskLogs[selectedTab] || [];
  }, [selectedTab, overallLogs, subtaskLogs]);

  const currentStatus = useMemo((): ExecutionLogStatus => {
    if (selectedTab === null) {
      return overallStatus;
    }
    const subtask = subtasks.find((s) => s.id === selectedTab);
    return subtask ? toLogStatus(subtask.status) : 'idle';
  }, [selectedTab, overallStatus, subtasks]);

  const currentIsRunning = useMemo(() => {
    if (selectedTab === null) {
      return isRunning;
    }
    const subtask = subtasks.find((s) => s.id === selectedTab);
    return subtask?.status === 'running';
  }, [selectedTab, isRunning, subtasks]);

  // Show standard log viewer when no tabs
  if (subtasks.length === 0) {
    return (
      <ExecutionLogViewer
        logs={overallLogs}
        status={overallStatus}
        isConnected={isConnected}
        isRunning={isRunning}
        maxHeight={maxHeight}
        collapsible={false}
        className={className}
      />
    );
  }

  return (
    <div className={`bg-zinc-800/50 rounded-lg overflow-hidden ${className}`}>
      <div className="flex items-center gap-1 px-2 py-1.5 bg-zinc-800 border-b border-zinc-700 overflow-x-auto scrollbar-thin scrollbar-thumb-zinc-600">
        <button
          onClick={() => setSelectedTab(null)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap transition-colors ${
            selectedTab === null
              ? 'bg-violet-600 text-white'
              : 'bg-zinc-700/50 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100'
          }`}
        >
          <Layers className="w-3 h-3" />
          全体
          {getStatusIcon(overallStatus)}
        </button>

        {subtasks.map((subtask) => (
          <button
            key={subtask.id}
            onClick={() => setSelectedTab(subtask.id)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap transition-colors ${
              selectedTab === subtask.id
                ? 'bg-indigo-600 text-white'
                : 'bg-zinc-700/50 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100'
            }`}
            title={subtask.title}
          >
            <span className="max-w-[120px] truncate">{subtask.title}</span>
            {getStatusIcon(subtask.status)}
          </button>
        ))}
      </div>

      <div className="relative">
        {loadingSubtaskId === selectedTab && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/80 z-10">
            <Loader2 className="w-5 h-5 animate-spin text-violet-400" />
          </div>
        )}
        <ExecutionLogViewer
          logs={currentLogs}
          status={currentStatus}
          isConnected={selectedTab === null ? isConnected : false}
          isRunning={currentIsRunning}
          maxHeight={maxHeight}
          collapsible={false}
          showHeader={false}
        />
      </div>
    </div>
  );
};

export default TabbedExecutionLogViewer;
