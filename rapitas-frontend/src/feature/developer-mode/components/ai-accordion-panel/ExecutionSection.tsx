/**
 * ExecutionSection
 *
 * Accordion section for agent execution. Renders the collapsible header with
 * context-sensitive action buttons (stop / reset / re-run / approve) and
 * delegates expanded body rendering to ExecutionBody.
 * Purely presentational — all logic is injected via props.
 */

'use client';

import {
  Rocket,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Play,
  Square,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import Link from 'next/link';
import type { Task } from '@/types';
import type { ExecutionLogStatus } from '../ExecutionLogViewer';
import type { ParallelExecutionStatus } from '@/feature/tasks/components/SubtaskExecutionStatus';
import { ExecutionBody } from './ExecutionBody';

export type ExecutionSectionProps = {
  isExpanded: boolean;
  onToggle: () => void;
  // Status flags
  isRunning: boolean;
  isCompleted: boolean;
  isCancelled: boolean;
  isFailed: boolean | string | null | undefined;
  isInterrupted: boolean | string | null | undefined;
  isExecuting: boolean;
  isParallelExecutionRunning?: boolean;
  hasSubtasks: boolean;
  execStatusIcon: 'loading' | 'success' | 'error' | 'cancelled' | 'interrupted' | 'idle';
  // Logs
  logs: string[];
  showLogs: boolean;
  logViewerStatus: ExecutionLogStatus;
  isSseConnected: boolean;
  executionError: string | null;
  pollingSessionMode?: string | null;
  // Question UI
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
  getSubtaskStatus?: (subtaskId: number) => ParallelExecutionStatus | undefined;
  onRefreshSubtaskLogs?: (taskId?: number) => void;
  // Continuation (after completed)
  continueInstruction: string;
  onSetContinueInstruction: (v: string) => void;
  onContinueExecution: () => Promise<void>;
  // Initial form (before execution)
  optimizedPrompt?: string | null;
  instruction: string;
  branchName: string;
  isGeneratingBranchName: boolean;
  onSetInstruction: (v: string) => void;
  onSetBranchName: (v: string) => void;
  onGenerateBranchName: () => Promise<void>;
  // Action handlers
  onExecute: () => Promise<void>;
  onStop: () => Promise<void>;
  onReset: () => void;
  onRerun: () => Promise<void>;
};

/**
 * Collapsible execution accordion section with a context-aware action bar.
 * Mounts ExecutionBody inside the expanded area.
 *
 * @param props - All derived state and event handlers from the parent component.
 */
export function ExecutionSection({
  isExpanded,
  onToggle,
  isRunning,
  isCompleted,
  isCancelled,
  isFailed,
  isInterrupted,
  isExecuting,
  isParallelExecutionRunning,
  hasSubtasks,
  execStatusIcon,
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
  onExecute,
  onStop,
  onReset,
  onRerun,
}: ExecutionSectionProps) {
  return (
    <div>
      {/* Accordion header with action buttons */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors cursor-pointer"
        aria-expanded={isExpanded}
        aria-controls="execution-section-content"
      >
        <div className="flex items-center gap-2">
          <Rocket className="w-4 h-4 text-indigo-500" />
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            エージェント実行
          </span>
          {execStatusIcon === 'loading' && (
            <Loader2 className="w-3 h-3 text-indigo-500 animate-spin" />
          )}
          {execStatusIcon === 'success' && (
            <CheckCircle2 className="w-3 h-3 text-green-500" />
          )}
          {execStatusIcon === 'error' && (
            <AlertCircle className="w-3 h-3 text-red-500" />
          )}
          {execStatusIcon === 'cancelled' && (
            <span className="px-1 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 text-[10px] rounded">
              停止
            </span>
          )}
          {execStatusIcon === 'interrupted' && (
            <span className="px-1 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-[10px] rounded">
              中断
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {isRunning && (
            <button
              onClick={(e) => { e.stopPropagation(); onStop(); }}
              className="flex items-center gap-1 px-2 py-1 bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 text-[10px] font-medium rounded transition-colors"
              aria-label="実行を停止"
            >
              <Square className="w-2.5 h-2.5" />
              停止
            </button>
          )}
          {isCompleted && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); onReset(); }}
                className="flex items-center gap-1 px-2 py-1 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-[10px] rounded transition-colors"
              >
                <RefreshCw className="w-2.5 h-2.5" />
                リセット
              </button>
              <Link
                href="/approvals"
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1 px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-medium rounded transition-colors"
              >
                <ExternalLink className="w-2.5 h-2.5" />
                承認
              </Link>
            </>
          )}
          {isCancelled && (
            <button
              onClick={(e) => { e.stopPropagation(); onRerun(); }}
              className="flex items-center gap-1 px-2 py-1 bg-yellow-600 hover:bg-yellow-700 text-white text-[10px] font-medium rounded transition-colors"
            >
              <RefreshCw className="w-2.5 h-2.5" />
              再実行
            </button>
          )}
          {isInterrupted && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); onReset(); }}
                className="flex items-center gap-1 px-2 py-1 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-[10px] rounded transition-colors"
              >
                <RefreshCw className="w-2.5 h-2.5" />
                リセット
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onRerun(); }}
                className="flex items-center gap-1 px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-medium rounded transition-colors"
              >
                <RefreshCw className="w-2.5 h-2.5" />
                再実行
              </button>
            </>
          )}
          {isFailed && !isRunning && !isCompleted && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); onReset(); }}
                className="flex items-center gap-1 px-2 py-1 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-[10px] rounded transition-colors"
              >
                <RefreshCw className="w-2.5 h-2.5" />
                リセット
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onRerun(); }}
                className="flex items-center gap-1 px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-[10px] font-medium rounded transition-colors"
              >
                <RefreshCw className="w-2.5 h-2.5" />
                再試行
              </button>
            </>
          )}
          {!isRunning && !isCompleted && !isCancelled && !isFailed && !isInterrupted && (
            <button
              onClick={(e) => { e.stopPropagation(); onExecute(); }}
              disabled={isExecuting || isParallelExecutionRunning}
              className="flex items-center gap-1 px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-medium rounded transition-colors disabled:opacity-50"
              aria-label={hasSubtasks ? 'サブタスクを実行' : '実行開始'}
            >
              <Play className="w-2.5 h-2.5" />
              {hasSubtasks ? 'サブタスクを実行' : '実行'}
            </button>
          )}
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-zinc-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-zinc-400" />
          )}
        </div>
      </div>

      {isExpanded && (
        <div id="execution-section-content" className="px-4 pb-3 space-y-3">
          <ExecutionBody
            isRunning={isRunning}
            isCompleted={isCompleted}
            isCancelled={isCancelled}
            isFailed={isFailed}
            isInterrupted={isInterrupted}
            isExecuting={isExecuting}
            logs={logs}
            showLogs={showLogs}
            logViewerStatus={logViewerStatus}
            isSseConnected={isSseConnected}
            executionError={executionError}
            pollingSessionMode={pollingSessionMode}
            hasQuestion={hasQuestion}
            question={question}
            userResponse={userResponse}
            isSendingResponse={isSendingResponse}
            onSetUserResponse={onSetUserResponse}
            onSendResponse={onSendResponse}
            subtasks={subtasks}
            subtaskLogs={subtaskLogs}
            parallelSessionId={parallelSessionId}
            hasSubtasks={hasSubtasks}
            getSubtaskStatus={getSubtaskStatus}
            onRefreshSubtaskLogs={onRefreshSubtaskLogs}
            continueInstruction={continueInstruction}
            onSetContinueInstruction={onSetContinueInstruction}
            onContinueExecution={onContinueExecution}
            optimizedPrompt={optimizedPrompt}
            instruction={instruction}
            branchName={branchName}
            isGeneratingBranchName={isGeneratingBranchName}
            onSetInstruction={onSetInstruction}
            onSetBranchName={onSetBranchName}
            onGenerateBranchName={onGenerateBranchName}
          />
        </div>
      )}
    </div>
  );
}
