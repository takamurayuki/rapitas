'use client';
// ExecutionBody

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

/** Maps a workflow session mode to its phase-label translation key. */
const WORKFLOW_PHASE_LABEL_KEYS: Record<string, string> = {
  'workflow-researcher': 'phase.researcher',
  'workflow-planner': 'phase.planner',
  'workflow-reviewer': 'phase.reviewer',
  'workflow-implementer': 'phase.implementer',
  'workflow-verifier': 'phase.verifier',
};

/**
 * Returns a translated phase label for workflow session modes.
 *
 * @param mode - Session mode string starting with "workflow-".
 * @param t - Translator scoped to `devMode.executionSection`. / `devMode.executionSection` にスコープした翻訳関数
 * @returns Human-readable phase label / 人間が読めるフェーズラベル
 */
export function workflowPhaseLabel(mode: string, t: (key: string) => string): string {
  return t(WORKFLOW_PHASE_LABEL_KEYS[mode] || 'phase.default');
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
          ) : null}
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
