'use client';
// ExecutionBody

import { useTranslations } from 'next-intl';
import { Spinner } from '@/components/ui/spinner';
import { ExecutionLogViewer, type ExecutionLogStatus } from '../ExecutionLogViewer';
import { SubtaskLogTabs } from '../SubtaskLogTabs';
import type { Task } from '@/types';
import type { ParallelExecutionStatus } from '@/feature/tasks/components/status/SubtaskExecutionStatus';
import { ContinuationForm } from './ContinuationForm';
import { IdleExecutionForm } from './idle-execution-form';
import { AgentQuestionCard } from './agent-question-card';

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
  pollingSessionMode: _pollingSessionMode,
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
  optimizedPrompt,
  instruction,
  branchName,
  baseBranch,
  baseBranches,
  isGeneratingBranchName: _isGeneratingBranchName,
  onSetInstruction,
  onSetBranchName,
  onSetBaseBranch,
  onGenerateBranchName: _onGenerateBranchName,
}: ExecutionBodyProps) {
  const t = useTranslations('devMode.executionSection');
  const hasSubtaskLogs = !!(hasSubtasks && subtaskLogs && parallelSessionId);

  // Running state
  if (isRunning) {
    return (
      <div className="space-y-2">
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
        <div id="execution-logs">
          {hasSubtaskLogs ? (
            <SubtaskLogTabs
              subtasks={subtasks || []}
              getSubtaskStatus={getSubtaskStatus}
              subtaskLogs={subtaskLogs!}
              isRunning={isRunning}
              onRefreshLogs={onRefreshSubtaskLogs}
              maxHeight={300}
            />
          ) : logs.length > 0 ? (
            <ExecutionLogViewer
              logs={logs}
              status={logViewerStatus}
              isConnected={isSseConnected}
              isRunning={isRunning}
              collapsible={false}
              maxHeight={300}
              resizable
            />
          ) : (
            // NOTE: Before the first log line streams in (or when there's no
            // log viewer to show at all — e.g. a non-subtask run whose
            // stream hasn't connected yet), this body was previously blank
            // with zero indication anything was happening. A running task
            // with no visible feedback reads as broken/stuck to the user.
            !hasQuestion && (
              <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
                <Spinner size="sm" />
                {t('runningNoLogsYet')}
              </div>
            )
          )}
        </div>
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
            resizable
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
        resizable
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
        resizable
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
            resizable
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
