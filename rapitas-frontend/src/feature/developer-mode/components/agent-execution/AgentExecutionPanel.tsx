'use client';
// AgentExecutionPanel

import React from 'react';
import type {
  ExecutionStatus,
  ExecutionResult,
} from '../../hooks/useDeveloperMode';
import {
  ExecutionLogViewer,
  type ExecutionLogStatus,
} from '../ExecutionLogViewer';
import { SubtaskLogTabs } from '../SubtaskLogTabs';
import type { Task } from '@/types';
import type { ParallelExecutionStatus } from '@/feature/tasks/components/SubtaskExecutionStatus';
import { useAgentExecution } from './useAgentExecution';
import { ExecutionRunningPanel } from './ExecutionRunningPanel';
import { ExecutionCompletedPanel } from './ExecutionCompletedPanel';
import { ExecutionCancelledPanel } from './ExecutionCancelledPanel';
import { ExecutionFailedPanel } from './ExecutionFailedPanel';
import { ExecutionIdlePanel } from './ExecutionIdlePanel';

export type Props = {
  taskId: number;
  isExecuting: boolean;
  /** When true, show skeleton loader unconditionally — takes priority over all other states. */
  forceSkeletonLoader?: boolean;
  executionStatus: ExecutionStatus;
  executionResult: ExecutionResult | null;
  error: string | null;
  workingDirectory?: string;
  defaultBranch?: string;
  useTaskAnalysis?: boolean;
  optimizedPrompt?: string | null;
  agentConfigId?: number | null;
  onExecute: (options?: {
    instruction?: string;
    branchName?: string;
    useTaskAnalysis?: boolean;
    optimizedPrompt?: string;
    agentConfigId?: number;
  }) => Promise<{ sessionId?: number; message?: string } | null>;
  onReset: () => void;
  // NOTE: Restores previous execution state on mount
  onRestoreExecutionState?: () => Promise<{
    sessionId: number;
    executionId?: number;
    output?: string;
    status: string;
    waitingForInput?: boolean;
    question?: string;
  } | null>;
  // NOTE: Callback for parent component state update on execution stop
  onStopExecution?: () => void;
  // NOTE: Callback for parent component state update on execution complete
  onExecutionComplete?: () => void;
  // Subtask-related props (for tab display)
  subtasks?: Task[];
  subtaskLogs?: Map<
    number,
    { logs: Array<{ timestamp: string; message: string; level: string }> }
  >;
  parallelSessionId?: string | null;
  getSubtaskStatus?: (subtaskId: number) => ParallelExecutionStatus | undefined;
  onRefreshSubtaskLogs?: (taskId?: number) => void;
};

/**
 * Top-level agent execution panel.
 * Delegates state management to useAgentExecution and rendering to sub-panels.
 *
 * @param props - See Props type
 */
export function AgentExecutionPanel(props: Props) {
  const {
    taskId,
    isExecuting,
    executionResult,
    error,
    subtasks,
    subtaskLogs,
    parallelSessionId,
    getSubtaskStatus,
    onRefreshSubtaskLogs,
    optimizedPrompt,
  } = props;

  const state = useAgentExecution(props);

  const {
    isExpanded,
    setIsExpanded,
    showOptions,
    setShowOptions,
    selectedAgentId,
    setSelectedAgentId,
    instruction,
    setInstruction,
    branchName,
    setBranchName,
    userResponse,
    setUserResponse,
    isSendingResponse,
    followUpInstruction,
    setFollowUpInstruction,
    followUpError,
    setFollowUpError,
    prState,
    setPrState,
    timeoutCountdown,
    logs,
    isSseConnected,
    pollingTokensUsed,
    pollingSessionMode,
    isRunning,
    isCompleted,
    isCancelled,
    isFailed,
    isWaitingForInput,
    logViewerStatus,
    hasQuestion,
    question,
    questionParsed,
    hasOptions,
    isConfirmedQuestion,
    hasSubtaskTabs,
    handleExecute,
    handleFollowUpExecute,
    handleSendResponse,
    handleStopExecution,
    handleReset,
    handleCreatePR,
    handleApproveMerge,
  } = state;

  /**
   * Build the shared log node. Subtask tabs take priority over the single-session log.
   *
   * @param running - Whether execution is currently in progress
   * @param maxHeight - Maximum pixel height of the log area
   */
  const buildLogsNode = (
    running: boolean,
    maxHeight = 256,
  ): React.ReactNode => {
    if (hasSubtaskTabs) {
      return (
        <SubtaskLogTabs
          subtasks={subtasks!}
          getSubtaskStatus={getSubtaskStatus}
          subtaskLogs={subtaskLogs!}
          isRunning={running}
          onRefreshLogs={onRefreshSubtaskLogs}
          maxHeight={maxHeight}
        />
      );
    }

    if (logs.length > 0) {
      return (
        <ExecutionLogViewer
          logs={logs}
          status={logViewerStatus as ExecutionLogStatus}
          isConnected={isSseConnected}
          isRunning={running}
          collapsible={false}
          maxHeight={maxHeight}
        />
      );
    }

    return null;
  };

  // NOTE: forceSkeletonLoader takes absolute priority — show skeleton before any state check
  if (props.forceSkeletonLoader || state.isRestoring) {
    return (
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden animate-pulse">
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-2xl bg-zinc-200 dark:bg-zinc-700" />
            <div className="flex-1 space-y-3">
              <div className="h-5 bg-zinc-200 dark:bg-zinc-700 rounded w-48" />
              <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded w-72" />
            </div>
          </div>
        </div>
        <div className="px-6 pb-4">
          <div className="h-24 bg-zinc-100 dark:bg-zinc-800 rounded-lg" />
        </div>
      </div>
    );
  }

  if (isRunning) {
    return (
      <ExecutionRunningPanel
        isWaitingForInput={isWaitingForInput}
        hasQuestion={hasQuestion}
        question={question}
        isConfirmedQuestion={isConfirmedQuestion}
        questionParsed={questionParsed}
        hasOptions={hasOptions}
        userResponse={userResponse}
        setUserResponse={setUserResponse}
        isSendingResponse={isSendingResponse}
        timeoutCountdown={timeoutCountdown}
        pollingTokensUsed={pollingTokensUsed}
        logsNode={buildLogsNode(true)}
        onStop={handleStopExecution}
        onSendResponse={handleSendResponse}
      />
    );
  }

  if (isCompleted && executionResult?.success) {
    return (
      <ExecutionCompletedPanel
        pollingSessionMode={pollingSessionMode}
        pollingTokensUsed={pollingTokensUsed}
        isExecuting={isExecuting}
        followUpInstruction={followUpInstruction}
        setFollowUpInstruction={setFollowUpInstruction}
        followUpError={followUpError}
        clearFollowUpError={() => setFollowUpError(null)}
        prState={prState}
        resetPrState={() => setPrState({ status: 'idle' })}
        logsNode={buildLogsNode(false)}
        onFollowUpExecute={handleFollowUpExecute}
        onReset={handleReset}
        onCreatePR={handleCreatePR}
        onApproveMerge={handleApproveMerge}
      />
    );
  }

  if (isCancelled) {
    return (
      <ExecutionCancelledPanel
        pollingTokensUsed={pollingTokensUsed}
        logsNode={buildLogsNode(false)}
        onReset={handleReset}
      />
    );
  }

  if (isFailed) {
    return (
      <ExecutionFailedPanel
        errorMessage={
          error || executionResult?.error || '不明なErrorが発生しました'
        }
        pollingTokensUsed={pollingTokensUsed}
        isExecuting={isExecuting}
        logsNode={buildLogsNode(false)}
        onReset={handleReset}
        onRetry={handleExecute}
      />
    );
  }

  return (
    <ExecutionIdlePanel
      taskId={taskId}
      isExpanded={isExpanded}
      setIsExpanded={setIsExpanded}
      showOptions={showOptions}
      setShowOptions={setShowOptions}
      hasOptimizedPrompt={!!optimizedPrompt}
      isExecuting={isExecuting}
      selectedAgentId={selectedAgentId}
      setSelectedAgentId={setSelectedAgentId}
      instruction={instruction}
      setInstruction={setInstruction}
      branchName={branchName}
      setBranchName={setBranchName}
      logsNode={buildLogsNode(!!isRunning)}
      onExecute={handleExecute}
    />
  );
}
