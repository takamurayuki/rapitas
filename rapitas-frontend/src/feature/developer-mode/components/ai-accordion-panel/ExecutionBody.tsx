'use client';
// ExecutionBody

import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sparkles,
  Send,
  Square,
  GitBranch,
  Wand2,
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
              maxHeight={180}
            />
          ) : logs.length > 0 ? (
            <ExecutionLogViewer
              logs={logs}
              status={logViewerStatus}
              isConnected={isSseConnected}
              isRunning={isRunning}
              collapsible={false}
              maxHeight={150}
            />
          ) : null}
        </div>
      </div>
    );
  }

  // Completed state
  if (isCompleted) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          <span className="text-xs text-emerald-700 dark:text-emerald-300">
            {pollingSessionMode?.startsWith('workflow-')
              ? workflowPhaseLabel(pollingSessionMode)
              : '実行完了'}
          </span>
        </div>
        {hasSubtaskLogs ? (
          <SubtaskLogTabs
            subtasks={subtasks || []}
            getSubtaskStatus={getSubtaskStatus}
            subtaskLogs={subtaskLogs!}
            isRunning={false}
            onRefreshLogs={onRefreshSubtaskLogs}
            maxHeight={180}
          />
        ) : logs.length > 0 && showLogs ? (
          <ExecutionLogViewer
            logs={logs}
            status={logViewerStatus}
            isConnected={isSseConnected}
            isRunning={false}
            collapsible={false}
            maxHeight={150}
          />
        ) : null}
        {/* Continuation input */}
        <ContinuationForm
          continueInstruction={continueInstruction}
          onSetContinueInstruction={onSetContinueInstruction}
          onContinueExecution={onContinueExecution}
          isExecuting={isExecuting}
        />
      </div>
    );
  }

  // Cancelled state
  if (isCancelled) {
    return (
      <div className="flex items-center gap-1.5 p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
        <Square className="w-3.5 h-3.5 text-yellow-500" />
        <span className="text-xs text-yellow-700 dark:text-yellow-300">
          実行を停止しました
        </span>
      </div>
    );
  }

  // Interrupted state
  if (isInterrupted) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 p-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
          <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
          <span className="text-xs text-amber-700 dark:text-amber-300">
            実行が中断されました
          </span>
        </div>
        {logs.length > 0 && showLogs && (
          <ExecutionLogViewer
            logs={logs}
            status="failed"
            isConnected={false}
            isRunning={false}
            collapsible={false}
            maxHeight={150}
          />
        )}
      </div>
    );
  }

  // Failed state
  if (isFailed) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 p-2 bg-red-50 dark:bg-red-900/20 rounded-lg">
          <AlertCircle className="w-3.5 h-3.5 text-red-500" />
          <span className="text-xs text-red-600 dark:text-red-400 line-clamp-2">
            {typeof executionError === 'string'
              ? executionError
              : 'エラーが発生しました'}
          </span>
        </div>
        {logs.length > 0 && showLogs && (
          <ExecutionLogViewer
            logs={logs}
            status="failed"
            isConnected={false}
            isRunning={false}
            collapsible={false}
            maxHeight={150}
          />
        )}
      </div>
    );
  }

  // Initial (idle) state — execution form
  return (
    <div className="space-y-2">
      {optimizedPrompt && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-green-50 dark:bg-green-900/20 rounded border border-green-200 dark:border-green-800">
          <Sparkles className="w-2.5 h-2.5 text-green-600 dark:text-green-400" />
          <span className="text-[10px] text-green-700 dark:text-green-300">
            最適化プロンプト使用
          </span>
        </div>
      )}
      <div className="space-y-2 p-2.5 bg-zinc-50 dark:bg-zinc-800/30 rounded-lg">
        <div>
          <label className="text-[10px] text-zinc-600 dark:text-zinc-400 mb-1 block">
            追加指示
          </label>
          <textarea
            value={instruction}
            onChange={(e) => onSetInstruction(e.target.value)}
            placeholder="追加の実装指示..."
            rows={2}
            className="w-full px-2 py-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-[10px] resize-none"
            aria-label="追加の実装指示"
          />
        </div>
        <div>
          <label className="flex items-center gap-1 text-[10px] text-zinc-600 dark:text-zinc-400 mb-1">
            <GitBranch className="w-2.5 h-2.5" />
            ブランチ名
          </label>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={branchName}
              onChange={(e) => onSetBranchName(e.target.value)}
              placeholder="feature/..."
              className="flex-1 px-2 py-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-[10px] font-mono"
              aria-label="ブランチ名"
            />
            <button
              onClick={onGenerateBranchName}
              disabled={isGeneratingBranchName}
              className="px-2 py-1 bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 rounded text-[10px] hover:bg-violet-200 dark:hover:bg-violet-900/50 transition-colors disabled:opacity-50 flex items-center gap-1"
              title="AIでブランチ名を生成"
            >
              {isGeneratingBranchName ? (
                <Loader2 className="w-2.5 h-2.5 animate-spin" />
              ) : (
                <Wand2 className="w-2.5 h-2.5" />
              )}
              <span>生成</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
