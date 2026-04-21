'use client';
// ExecutionBody

import { useState } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sparkles,
  Send,
  Square,
  GitBranch,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  ExecutionLogViewer,
  type ExecutionLogStatus,
} from '../ExecutionLogViewer';
import { SubtaskLogTabs } from '../SubtaskLogTabs';
import type { Task } from '@/types';
import type { ParallelExecutionStatus } from '@/feature/tasks/components/SubtaskExecutionStatus';
import { ContinuationForm } from './ContinuationForm';

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
  userResponse: string;
  isSendingResponse: boolean;
  onSetUserResponse: (v: string) => void;
  onSendResponse: () => Promise<void>;
  // Subtask logs
  subtasks?: Task[];
  subtaskLogs?: Map<
    number,
    { logs: Array<{ timestamp: string; message: string; level: string }> }
  >;
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
  isGeneratingBranchName: boolean;
  onSetInstruction: (v: string) => void;
  onSetBranchName: (v: string) => void;
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
  isGeneratingBranchName,
  onSetInstruction,
  onSetBranchName,
  onGenerateBranchName,
}: ExecutionBodyProps) {
  const hasSubtaskLogs = !!(hasSubtasks && subtaskLogs && parallelSessionId);

  // Running state
  if (isRunning) {
    return (
      <div className="space-y-2">
        {hasQuestion && (
          <div className="p-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
            <p className="text-[10px] text-amber-800 dark:text-amber-200 font-mono mb-1.5 whitespace-pre-wrap line-clamp-3">
              {question.length > 150 ? `${question.slice(-150)}...` : question}
            </p>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={userResponse}
                onChange={(e) => onSetUserResponse(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onSendResponse()}
                placeholder="回答を入力..."
                className="flex-1 px-2 py-1 bg-white dark:bg-zinc-800 border border-amber-300 dark:border-amber-700 rounded text-[10px]"
                autoFocus
                aria-label="エージェントへの回答"
              />
              <button
                onClick={onSendResponse}
                disabled={!userResponse.trim() || isSendingResponse}
                className="flex items-center gap-1 px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-medium rounded transition-colors disabled:opacity-50"
                aria-label="回答を送信"
              >
                {isSendingResponse ? (
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                ) : (
                  <Send className="w-2.5 h-2.5" />
                )}
                送信
              </button>
            </div>
          </div>
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
      onSetInstruction={onSetInstruction}
      onSetBranchName={onSetBranchName}
    />
  );
}

/** Compact idle-state execution form with inline instruction + collapsible details. */
function IdleExecutionForm({
  optimizedPrompt,
  instruction,
  branchName,
  onSetInstruction,
  onSetBranchName,
}: {
  optimizedPrompt?: string | null;
  instruction: string;
  branchName: string;
  onSetInstruction: (v: string) => void;
  onSetBranchName: (v: string) => void;
}) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="space-y-2">
      {/* Inline instruction input */}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={instruction}
          onChange={(e) => onSetInstruction(e.target.value)}
          placeholder="追加指示があれば入力...（任意）"
          className="flex-1 px-2.5 py-1.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
          aria-label="追加の実装指示"
        />
      </div>

      {/* Status badges */}
      {optimizedPrompt && (
        <div className="flex items-center gap-1.5 px-1">
          <Sparkles className="w-2.5 h-2.5 text-green-500" />
          <span className="text-[10px] text-green-600 dark:text-green-400">最適化プロンプト適用済み</span>
        </div>
      )}

      {/* Collapsible details */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="flex items-center gap-1 px-1 text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
      >
        {showDetails ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
        詳細設定
      </button>

      {showDetails && (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-2.5 space-y-2">
          <div>
            <label className="flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400 mb-1">
              <GitBranch className="w-2.5 h-2.5" />
              ブランチ名
              <span className="text-zinc-400 dark:text-zinc-500">（空欄で自動生成）</span>
            </label>
            <input
              type="text"
              value={branchName}
              onChange={(e) => onSetBranchName(e.target.value)}
              placeholder="自動生成されます"
              className="w-full px-2 py-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
              aria-label="ブランチ名"
            />
          </div>
        </div>
      )}
    </div>
  );
}
