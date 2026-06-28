'use client';
// ExecutionBody

import { Loader2 } from 'lucide-react';
import { ExecutionLogViewer, type ExecutionLogStatus } from '../ExecutionLogViewer';
import { SubtaskLogTabs } from '../SubtaskLogTabs';
import type { Task, WorkflowStatus } from '@/types';
import type { ParallelExecutionStatus } from '@/feature/tasks/components/status/SubtaskExecutionStatus';
import { ContinuationForm } from './ContinuationForm';
import { IdleExecutionForm } from './idle-execution-form';
import { AgentQuestionCard } from './agent-question-card';
import WorkflowStatusIndicator from '@/components/workflow/WorkflowStatusIndicator';

export type ExecutionBodyProps = {
  isRunning: boolean;
  isCompleted: boolean;
  isCancelled: boolean;
  isFailed: boolean | string | null | undefined;
  isInterrupted: boolean | string | null | undefined;
  isExecuting: boolean;
  // Logs
  logs: string[];
  showLogs: boolean;
  logViewerStatus: ExecutionLogStatus;
  isSseConnected: boolean;
  executionError: string | null;
  pollingSessionMode?: string | null;
  // Question
  hasQuestion: boolean;
  question: string;
  questionDetails?: {
    options?: Array<{ label: string; description?: string }>;
    headers?: string[];
    multiSelect?: boolean;
    questions?: Array<{
      header?: string;
      question: string;
      options?: Array<{ label: string; description?: string }>;
      multiSelect?: boolean;
    }>;
  } | null;
  userResponse: string;
  isSendingResponse: boolean;
  onSetUserResponse: (v: string) => void;
  onSendResponse: () => Promise<void>;
  // Subtask logs
  subtasks?: Task[];
  subtaskLogs?: Map<number, { logs: Array<{ timestamp: string; message: string; level: string }> }>;
  parallelSessionId?: string | null;
  hasSubtasks: boolean;
  getSubtaskStatus?: (subtaskId: number) => ParallelExecutionStatus | undefined;
  onRefreshSubtaskLogs?: (taskId?: number) => void;
  // Continuation
  continueInstruction: string;
  onSetContinueInstruction: (v: string) => void;
  onContinueExecution: () => Promise<void>;
  // Workflow phase shown when running (replaces log display)
  workflowStatus?: string | null;
  workflowMode?: string | null;
  // Initial form
  optimizedPrompt?: string | null;
  instruction: string;
  branchName: string;
  baseBranch: string;
  baseBranches: string[];
  isGeneratingBranchName: boolean;
  onSetInstruction: (v: string) => void;
  onSetBranchName: (v: string) => void;
  onSetBaseBranch: (v: string) => void;
  onGenerateBranchName: () => Promise<void>;
};

/**
 * Returns a Japanese phase label for workflow session modes.
 *
 * @param mode - Session mode string starting with "workflow-".
 * @returns Human-readable phase label / <日本語フェーズラベル>
 */
export function workflowPhaseLabel(mode: string): string {
  const labels: Record<string, string> = {
    'workflow-researcher': '調査フェーズ完了',
    'workflow-planner': '計画フェーズ完了',
    'workflow-reviewer': 'レビューフェーズ完了',
    'workflow-implementer': '実装フェーズ完了',
    'workflow-verifier': '検証フェーズ完了',
  };
  return labels[mode] || 'フェーズ完了';
}

/**
 * Renders the appropriate execution body based on current status.
 * The parent (ExecutionSection) is responsible for mounting this inside the expanded panel.
 *
 * @param props - Derived state and handlers from useExecutionManager.
 */
export function ExecutionBody({
  isRunning,
  isCompleted,
  isCancelled,
  isFailed,
  isInterrupted,
  isExecuting,
  logs,
  showLogs,
  logViewerStatus,
  isSseConnected,
  executionError,
  pollingSessionMode,
  hasQuestion,
  question,
  questionDetails,
  userResponse,
  isSendingResponse,
  onSetUserResponse,
  onSendResponse,
  subtasks,
  subtaskLogs,
  parallelSessionId,
  hasSubtasks,
  getSubtaskStatus,
  onRefreshSubtaskLogs,
  continueInstruction,
  onSetContinueInstruction,
  onContinueExecution,
  workflowStatus,
  workflowMode,
  optimizedPrompt,
  instruction,
  branchName,
  baseBranch,
  baseBranches,
  isGeneratingBranchName,
  onSetInstruction,
  onSetBranchName,
  onSetBaseBranch,
  onGenerateBranchName,
}: ExecutionBodyProps) {
  const hasSubtaskLogs = !!(hasSubtasks && subtaskLogs && parallelSessionId);

  // Running state — blue panel with current workflow phase; no raw logs
  if (isRunning) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-4">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-blue-500 animate-spin flex-shrink-0" />
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                AIエージェント実行中
              </span>
              {workflowStatus && (
                <WorkflowStatusIndicator
                  status={workflowStatus as WorkflowStatus}
                  workflowMode={workflowMode}
                  size="sm"
                />
              )}
            </div>
          </div>
        </div>
        {hasQuestion && (
          <AgentQuestionCard
            question={question}
            questionDetails={questionDetails}
            userResponse={userResponse}
            isSendingResponse={isSendingResponse}
            onSetUserResponse={onSetUserResponse}
            onSendResponse={onSendResponse}
          />
        )}
      </div>
    );
  }

  // Completed state — status card removed, shown in ExecutionSection header badge
  if (isCompleted) {
    return (
      <div className="space-y-2">
        {hasSubtaskLogs ? (
          <SubtaskLogTabs
            subtasks={subtasks || []}
            getSubtaskStatus={getSubtaskStatus}
            subtaskLogs={subtaskLogs!}
            isRunning={false}
            onRefreshLogs={onRefreshSubtaskLogs}
            maxHeight={300}
          />
        ) : logs.length > 0 && showLogs ? (
          <ExecutionLogViewer
            logs={logs}
            status={logViewerStatus}
            isConnected={isSseConnected}
            isRunning={false}
            collapsible={false}
            maxHeight={300}
          />
        ) : null}
        <ContinuationForm
          continueInstruction={continueInstruction}
          onSetContinueInstruction={onSetContinueInstruction}
          onContinueExecution={onContinueExecution}
          isExecuting={isExecuting}
        />
      </div>
    );
  }

  // Cancelled state — status shown in header badge
  if (isCancelled) {
    return logs.length > 0 && showLogs ? (
      <ExecutionLogViewer
        logs={logs}
        status="cancelled"
        isConnected={false}
        isRunning={false}
        collapsible={false}
        maxHeight={300}
      />
    ) : null;
  }

  // Interrupted state — status shown in header badge
  if (isInterrupted) {
    return logs.length > 0 && showLogs ? (
      <ExecutionLogViewer
        logs={logs}
        status="failed"
        isConnected={false}
        isRunning={false}
        collapsible={false}
        maxHeight={300}
      />
    ) : null;
  }

  // Failed state — error detail shown inline only if message exists
  if (isFailed) {
    return (
      <div className="space-y-2">
        {typeof executionError === 'string' && executionError && (
          <p className="text-[10px] text-red-600 dark:text-red-400 line-clamp-2 px-1">
            {executionError}
          </p>
        )}
        {logs.length > 0 && showLogs && (
          <ExecutionLogViewer
            logs={logs}
            status="failed"
            isConnected={false}
            isRunning={false}
            collapsible={false}
            maxHeight={300}
          />
        )}
      </div>
    );
  }

  // Initial (idle) state — execution form
  return (
    <IdleExecutionForm
      optimizedPrompt={optimizedPrompt}
      instruction={instruction}
      branchName={branchName}
      baseBranch={baseBranch}
      baseBranches={baseBranches}
      onSetInstruction={onSetInstruction}
      onSetBranchName={onSetBranchName}
      onSetBaseBranch={onSetBaseBranch}
    />
  );
}
