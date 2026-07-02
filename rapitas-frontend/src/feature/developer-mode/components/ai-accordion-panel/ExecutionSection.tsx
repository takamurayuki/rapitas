'use client';
// ExecutionSection

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
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { Task } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import type { ExecutionLogStatus } from '../ExecutionLogViewer';
import type { ParallelExecutionStatus } from '@/feature/tasks/components/status/SubtaskExecutionStatus';
import { ExecutionBody, workflowPhaseLabel } from './ExecutionBody';
import { ExecutionCapabilityGuide, type ExecutionCapability } from './ExecutionCapabilityGuide';

export type ExecutionSectionProps = {
  /**
   * Capability state. When not `ready`, the body renders an inline setup
   * guide instead of the execution UI, and the header "実行" button is
   * disabled. Defaults to `ready` for backward compatibility.
   */
  capability?: ExecutionCapability;
  /** Theme ID for deep-linking the capability guide. */
  themeId?: number | null;
  /** Task ID — used to open this task's PR detail page after completion. */
  taskId: number;
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
  questionDetails?: {
    options?: Array<{ label: string; description?: string }>;
    headers?: string[];
    multiSelect?: boolean;
  } | null;
  userResponse: string;
  isSendingResponse: boolean;
  onSetUserResponse: (v: string) => void;
  onSendResponse: () => Promise<void>;
  // Subtask logs
  subtasks?: Task[];
  subtaskLogs?: Map<number, { logs: Array<{ timestamp: string; message: string; level: string }> }>;
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
  baseBranch: string;
  baseBranches: string[];
  isGeneratingBranchName: boolean;
  onSetInstruction: (v: string) => void;
  onSetBranchName: (v: string) => void;
  onSetBaseBranch: (v: string) => void;
  onGenerateBranchName: () => Promise<void>;
  // Action handlers
  onExecute: () => Promise<void>;
  onStop: () => Promise<void>;
  onReset: () => void;
  onRerun: () => Promise<void>;
  /** Raw task.status — disables the run button when the task is already done. */
  taskStatus?: string;
};

/**
 * Collapsible execution accordion section with a context-aware action bar.
 * Mounts ExecutionBody inside the expanded area.
 *
 * @param props - All derived state and event handlers from the parent component.
 */
export function ExecutionSection({
  capability = 'ready',
  themeId,
  taskId,
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
  questionDetails,
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
  baseBranch,
  baseBranches,
  isGeneratingBranchName,
  onSetInstruction,
  onSetBranchName,
  onSetBaseBranch,
  onGenerateBranchName,
  onExecute,
  onStop,
  onReset,
  onRerun,
  taskStatus,
}: ExecutionSectionProps) {
  const router = useRouter();
  const t = useTranslations('devMode.executionSection');
  const [prError, setPrError] = useState<string | null>(null);

  // NOTE: task.status reflects the manual status toggle, which is independent of
  // workflow polling state. We guard the run button on both to prevent re-running
  // a task the user has explicitly marked done.
  const isTaskDone = taskStatus === 'done' || taskStatus === 'completed';

  // Open this task's PR detail page (replaces the old approval-page link). The
  // PR is auto-created on completion, so resolve it by task and navigate. When
  // it can't be resolved, surface why (not created vs. created-but-not-synced)
  // instead of silently doing nothing.
  const openTaskPr = async () => {
    setPrError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/github/pull-requests/by-task/${taskId}`);
      if (res.ok) {
        const pr = (await res.json()) as { id: number };
        router.push(`/github/pull-requests/${pr.id}`);
        return;
      }
      const body = (await res.json().catch(() => null)) as {
        reason?: string;
        prUrl?: string;
        error?: string;
      } | null;
      // PR exists on GitHub but isn't synced locally — open it on GitHub.
      if (body?.reason === 'not_synced') {
        if (body.prUrl) window.open(body.prUrl, '_blank', 'noopener,noreferrer');
        setPrError(body.prUrl ? t('prNotSyncedOpened') : (body.error ?? t('prNotSynced')));
        return;
      }
      setPrError(body?.error ?? t('prNotCreated'));
    } catch {
      setPrError(t('prFetchFailed'));
    }
  };

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
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('title')}</span>
          {/* NOTE: Status badge shown only when collapsed — expanded view has its own status in logs */}
          {!isExpanded && execStatusIcon === 'loading' && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 text-[10px] rounded">
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
              {t('statusRunning')}
            </span>
          )}
          {!isExpanded && execStatusIcon === 'success' && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-[10px] rounded">
              <CheckCircle2 className="w-2.5 h-2.5" />
              {pollingSessionMode?.startsWith('workflow-')
                ? workflowPhaseLabel(pollingSessionMode, t)
                : t('statusCompleted')}
            </span>
          )}
          {!isExpanded && execStatusIcon === 'idle' && isTaskDone && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-[10px] rounded">
              <CheckCircle2 className="w-2.5 h-2.5" />
              {t('statusCompleted')}
            </span>
          )}
          {!isExpanded && execStatusIcon === 'error' && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-[10px] rounded">
              <AlertCircle className="w-2.5 h-2.5" />
              {t('statusError')}
            </span>
          )}
          {!isExpanded && execStatusIcon === 'cancelled' && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 text-[10px] rounded">
              <Square className="w-2.5 h-2.5" />
              {t('statusStopped')}
            </span>
          )}
          {!isExpanded && execStatusIcon === 'interrupted' && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-[10px] rounded">
              <AlertCircle className="w-2.5 h-2.5" />
              {t('statusInterrupted')}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {isRunning && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStop();
              }}
              className="flex items-center gap-1 px-2 py-1 bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 text-[10px] font-medium rounded transition-colors"
              aria-label={t('stopAria')}
            >
              <Square className="w-2.5 h-2.5" />
              {t('stop')}
            </button>
          )}
          {isCompleted && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onReset();
                }}
                className="flex items-center gap-1 px-2 py-1 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-[10px] rounded transition-colors"
              >
                <RefreshCw className="w-2.5 h-2.5" />
                {t('reset')}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openTaskPr();
                }}
                className="flex items-center gap-1 px-2 py-1 bg-green-600 hover:bg-green-700 text-white text-[10px] font-medium rounded transition-colors"
              >
                <ExternalLink className="w-2.5 h-2.5" />
                {t('openPr')}
              </button>
            </>
          )}
          {isCancelled && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRerun();
              }}
              className="flex items-center gap-1 px-2 py-1 bg-yellow-600 hover:bg-yellow-700 text-white text-[10px] font-medium rounded transition-colors"
            >
              <RefreshCw className="w-2.5 h-2.5" />
              {t('rerun')}
            </button>
          )}
          {isInterrupted && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onReset();
                }}
                className="flex items-center gap-1 px-2 py-1 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-[10px] rounded transition-colors"
              >
                <RefreshCw className="w-2.5 h-2.5" />
                {t('reset')}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRerun();
                }}
                className="flex items-center gap-1 px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-medium rounded transition-colors"
              >
                <RefreshCw className="w-2.5 h-2.5" />
                {t('rerun')}
              </button>
            </>
          )}
          {isFailed && !isRunning && !isCompleted && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onReset();
                }}
                className="flex items-center gap-1 px-2 py-1 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-[10px] rounded transition-colors"
              >
                <RefreshCw className="w-2.5 h-2.5" />
                {t('reset')}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRerun();
                }}
                className="flex items-center gap-1 px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-[10px] font-medium rounded transition-colors"
              >
                <RefreshCw className="w-2.5 h-2.5" />
                {t('retry')}
              </button>
            </>
          )}
          {!isRunning && !isCompleted && !isCancelled && !isFailed && !isInterrupted && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (capability === 'ready' && !isTaskDone) onExecute();
              }}
              disabled={isExecuting || capability !== 'ready' || isTaskDone}
              title={
                isTaskDone
                  ? t('runDisabledTaskDone')
                  : capability !== 'ready'
                    ? t('runDisabledSetupIncomplete')
                    : t('startExecution')
              }
              className="flex items-center gap-1 px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-medium rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label={t('startExecution')}
            >
              <Play className="w-2.5 h-2.5" />
              {t('run')}
            </button>
          )}
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-zinc-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-zinc-400" />
          )}
        </div>
      </div>

      {prError && (
        <div className="px-4 pb-2 -mt-1 flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>{prError}</span>
        </div>
      )}

      {isExpanded && capability !== 'ready' && (
        <div id="execution-section-content" className="px-4 pb-3 space-y-3">
          <ExecutionCapabilityGuide capability={capability} themeId={themeId} />
        </div>
      )}

      {isExpanded && capability === 'ready' && (
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
            questionDetails={questionDetails}
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
            baseBranch={baseBranch}
            baseBranches={baseBranches}
            isGeneratingBranchName={isGeneratingBranchName}
            onSetInstruction={onSetInstruction}
            onSetBranchName={onSetBranchName}
            onSetBaseBranch={onSetBaseBranch}
            onGenerateBranchName={onGenerateBranchName}
          />
        </div>
      )}
    </div>
  );
}
