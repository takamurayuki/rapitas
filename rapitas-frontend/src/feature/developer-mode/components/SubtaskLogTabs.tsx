'use client';

import { useState, useMemo } from 'react';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Circle,
  Clock,
  Pause,
  Terminal,
  RefreshCw,
  GitBranch,
  ArrowRight,
} from 'lucide-react';
import type { Task } from '@/types';
import type { ParallelExecutionStatus } from '@/feature/tasks/components/SubtaskExecutionStatus';
import { ExecutionLogViewer, type ExecutionLogStatus } from './ExecutionLogViewer';
import { WorkflowLogViewer } from './WorkflowLogViewer';

interface SubtaskLogTabsProps {
  /** List of subtasks */
  subtasks: Task[];
  /** Function to get subtask status */
  getSubtaskStatus?: (subtaskId: number) => ParallelExecutionStatus | undefined;
  /** Logs per subtask */
  subtaskLogs: Map<number, { logs: Array<{ timestamp: string; message: string; level: string }> }>;
  /** Whether overall execution is running */
  isRunning: boolean;
  /** Function to refresh logs */
  onRefreshLogs?: (taskId?: number) => void;
  /** Max height */
  maxHeight?: number;
  /** Whether running in workflow mode */
  useWorkflow?: boolean;
}

/** Get phase label from workflow status */
function getPhaseLabel(workflowStatus?: string): string {
  switch (workflowStatus) {
    case 'draft':
      return '初期化';
    case 'research_done':
      return '調査完了';
    case 'plan_created':
      return '計画作成';
    case 'plan_approved':
      return '計画承認済';
    case 'in_progress':
      return '実装中';
    case 'completed':
      return '完了';
    default:
      return workflowStatus || '待機中';
  }
}

/** Style based on workflow status */
function getPhaseStyle(workflowStatus?: string): string {
  switch (workflowStatus) {
    case 'completed':
      return 'text-green-400';
    case 'in_progress':
    case 'plan_approved':
      return 'text-blue-400';
    case 'plan_created':
      return 'text-amber-400';
    case 'research_done':
      return 'text-cyan-400';
    case 'draft':
      return 'text-zinc-400';
    default:
      return 'text-zinc-500';
  }
}

/**
 * Subtask execution log tabbed display component
 */
export function SubtaskLogTabs({
  subtasks,
  getSubtaskStatus,
  subtaskLogs,
  isRunning,
  onRefreshLogs,
  maxHeight = 200,
  useWorkflow = false,
}: SubtaskLogTabsProps) {
  // "All" tab + subtask tabs
  const [activeTab, setActiveTab] = useState<number | 'all'>('all');
  // Toggle workflow view mode
  const [showWorkflowView, setShowWorkflowView] = useState(useWorkflow);

  // Get icon for status
  const getStatusIcon = (status?: ParallelExecutionStatus) => {
    const iconClass = 'w-3 h-3';
    switch (status) {
      case 'running':
        return <Loader2 className={`${iconClass} text-blue-500 animate-spin`} />;
      case 'completed':
        return <CheckCircle2 className={`${iconClass} text-green-500`} />;
      case 'failed':
        return <XCircle className={`${iconClass} text-red-500`} />;
      case 'scheduled':
        return <Clock className={`${iconClass} text-blue-400`} />;
      case 'blocked':
        return <Pause className={`${iconClass} text-orange-500`} />;
      case 'cancelled':
        return <Pause className={`${iconClass} text-yellow-500`} />;
      case 'pending':
      default:
        return <Circle className={`${iconClass} text-zinc-400`} />;
    }
  };

  // Merge all logs
  const allLogs = useMemo(() => {
    const logs: Array<{
      timestamp: string;
      message: string;
      level: string;
      taskId?: number;
    }> = [];
    subtaskLogs.forEach((state, taskId) => {
      state.logs.forEach((log) => {
        logs.push({ ...log, taskId });
      });
    });
    // Sort by timestamp
    return logs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [subtaskLogs]);

  // Logs for the currently selected tab
  const currentLogs = useMemo((): Array<{
    timestamp: string;
    message: string;
    level: string;
    taskId?: number;
  }> => {
    if (activeTab === 'all') {
      return allLogs;
    }
    const subtaskLog = subtaskLogs.get(activeTab);
    // Add taskId to single subtask logs
    return (subtaskLog?.logs || []).map((log) => ({
      ...log,
      taskId: activeTab as number,
    }));
  }, [activeTab, allLogs, subtaskLogs]);

  // Convert to ExecutionLogViewer log format
  const formattedLogs = useMemo(() => {
    return currentLogs.map((log) => {
      const subtask = log.taskId ? subtasks.find((s) => s.id === log.taskId) : undefined;
      const prefix = activeTab === 'all' && subtask ? `[${subtask.title}] ` : '';
      return `${prefix}${log.message}`;
    });
  }, [currentLogs, activeTab, subtasks]);

  // Compute overall status
  const overallStatus: ExecutionLogStatus = useMemo(() => {
    if (isRunning) return 'running';

    let hasCompleted = false;
    let hasFailed = false;

    subtasks.forEach((subtask) => {
      const status = getSubtaskStatus?.(subtask.id);
      if (status === 'completed') hasCompleted = true;
      if (status === 'failed') hasFailed = true;
    });

    if (hasFailed) return 'failed';
    if (hasCompleted && !isRunning) return 'completed';
    return 'idle';
  }, [isRunning, subtasks, getSubtaskStatus]);

  // Get tab status
  const getTabStatus = (taskId: number): ExecutionLogStatus => {
    const status = getSubtaskStatus?.(taskId);
    switch (status) {
      case 'running':
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
  };

  // Completed count
  const completedCount = subtasks.filter((s) => getSubtaskStatus?.(s.id) === 'completed').length;

  // Estimate start time (from first log timestamp)
  const startTime = useMemo(() => {
    if (allLogs.length === 0) return null;
    return new Date(allLogs[0].timestamp);
  }, [allLogs]);

  // Calculate elapsed time
  const elapsedTime = useMemo(() => {
    if (!startTime) return null;
    const now = new Date();
    const elapsed = Math.floor((now.getTime() - startTime.getTime()) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    return `${minutes}分${seconds}秒`;
  }, [startTime]);

  if (subtasks.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-700">
        <button
          onClick={() => setActiveTab('all')}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-medium rounded-t-lg border-b-2 transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'all'
              ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border-indigo-500'
              : 'bg-zinc-50 dark:bg-indigo-dark-800/50 text-zinc-600 dark:text-zinc-400 border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800'
          }`}
        >
          <Terminal className="w-3 h-3" />
          <span>全体</span>
          {isRunning && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
          <span className="px-1 py-0.5 bg-zinc-200 dark:bg-zinc-700 rounded text-[9px]">
            {allLogs.length}
          </span>
        </button>

        {subtasks.map((subtask) => {
          const status = getSubtaskStatus?.(subtask.id);
          const logs = subtaskLogs.get(subtask.id)?.logs || [];
          const isActive = activeTab === subtask.id;

          return (
            <button
              key={subtask.id}
              onClick={() => setActiveTab(subtask.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-medium rounded-t-lg border-b-2 transition-colors whitespace-nowrap shrink-0 max-w-[150px] ${
                isActive
                  ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border-indigo-500'
                  : 'bg-zinc-50 dark:bg-indigo-dark-800/50 text-zinc-600 dark:text-zinc-400 border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
              title={subtask.title}
            >
              {getStatusIcon(status)}
              <span className="truncate">{subtask.title}</span>
              {logs.length > 0 && (
                <span className="px-1 py-0.5 bg-zinc-200 dark:bg-zinc-700 rounded text-[9px] shrink-0">
                  {logs.length}
                </span>
              )}
            </button>
          );
        })}

        {useWorkflow && (
          <button
            onClick={() => setShowWorkflowView((prev) => !prev)}
            className={`p-1.5 rounded transition-colors shrink-0 ml-1 ${
              showWorkflowView
                ? 'text-indigo-400 bg-indigo-900/30'
                : 'text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800'
            }`}
            title={showWorkflowView ? 'フラット表示に切替' : 'ワークフロー表示に切替'}
          >
            <GitBranch className="w-3 h-3" />
          </button>
        )}

        {onRefreshLogs && (
          <button
            onClick={() => onRefreshLogs(activeTab === 'all' ? undefined : activeTab)}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors shrink-0 ml-auto"
            title="ログを更新"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        )}
      </div>

      <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
        {activeTab !== 'all' && showWorkflowView && useWorkflow ? (
          // Workflow phase view (when individual tab is selected)
          <div className="p-2">
            <WorkflowLogViewer
              taskTitle={subtasks.find((s) => s.id === activeTab)?.title || ''}
              taskId={activeTab as number}
              logs={currentLogs}
              workflowStatus={subtasks.find((s) => s.id === activeTab)?.workflowStatus ?? undefined}
              isRunning={getSubtaskStatus?.(activeTab as number) === 'running'}
              maxHeight={maxHeight}
            />
          </div>
        ) : formattedLogs.length > 0 ? (
          <ExecutionLogViewer
            logs={formattedLogs}
            status={activeTab === 'all' ? overallStatus : getTabStatus(activeTab as number)}
            isRunning={
              activeTab === 'all'
                ? isRunning
                : getSubtaskStatus?.(activeTab as number) === 'running'
            }
            collapsible={false}
            maxHeight={maxHeight}
          />
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-zinc-400 dark:text-zinc-500">
            <Terminal className="w-6 h-6 mb-2 opacity-50" />
            <p className="text-[10px]">{isRunning ? 'ログを待機中...' : 'ログがありません'}</p>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[10px] text-zinc-500 dark:text-zinc-400">
          <span className="font-medium">進捗:</span>
          <span>
            {completedCount}/{subtasks.length} 完了
            {elapsedTime && isRunning && (
              <span className="ml-2 text-zinc-600">経過: {elapsedTime}</span>
            )}
          </span>
        </div>

        <div className="space-y-1">
          {subtasks.map((subtask) => {
            const status = getSubtaskStatus?.(subtask.id);
            const workflowStatus = (subtask as Task & { workflowStatus?: string }).workflowStatus;
            const hasWorkflowInfo = useWorkflow && workflowStatus;
            // Show dependency info (simplified check via parentId)
            const parentTask = subtask.parentId
              ? subtasks.find((s) => s.id === subtask.parentId)
              : null;

            return (
              <div
                key={subtask.id}
                className="flex items-center gap-2 text-[10px] px-2 py-1 rounded bg-zinc-50 dark:bg-zinc-900/50"
              >
                {getStatusIcon(status)}
                <span
                  className="truncate flex-1 text-zinc-700 dark:text-zinc-300"
                  title={subtask.title}
                >
                  {subtask.title}
                </span>
                {hasWorkflowInfo && (
                  <span className={`shrink-0 ${getPhaseStyle(workflowStatus)}`}>
                    {getPhaseLabel(workflowStatus)}
                  </span>
                )}
                {!hasWorkflowInfo && status && (
                  <span
                    className={`shrink-0 ${
                      status === 'completed'
                        ? 'text-green-400'
                        : status === 'running'
                          ? 'text-blue-400'
                          : status === 'failed'
                            ? 'text-red-400'
                            : status === 'blocked'
                              ? 'text-orange-400'
                              : 'text-zinc-500'
                    }`}
                  >
                    {status === 'completed'
                      ? '完了'
                      : status === 'running'
                        ? '実行中'
                        : status === 'failed'
                          ? '失敗'
                          : status === 'blocked'
                            ? 'ブロック中'
                            : status === 'scheduled'
                              ? 'スケジュール済'
                              : '待機中'}
                  </span>
                )}
                {parentTask && (
                  <span
                    className="flex items-center gap-0.5 text-zinc-500 shrink-0"
                    title={`依存先: ${parentTask.title}`}
                  >
                    <ArrowRight className="w-2.5 h-2.5" />
                    <span className="truncate max-w-[60px]">{parentTask.title}</span>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default SubtaskLogTabs;
