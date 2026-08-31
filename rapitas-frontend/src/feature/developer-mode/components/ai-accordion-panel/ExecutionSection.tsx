'use client';
// ExecutionSection

import {
  Rocket,
  AlertCircle,
  Play,
  Square,
  RefreshCw,
  RotateCcw,
  GitPullRequest,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { Task } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { PillButton } from '@/components/ui/pill-button';
import type { ExecutionLogStatus } from '../ExecutionLogViewer';
import type { ParallelExecutionStatus } from '@/feature/tasks/components/status/SubtaskExecutionStatus';
import { useTaskPrAvailability } from '../../hooks/useTaskPrAvailability';
import { ExecutionBody } from './ExecutionBody';
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
  // Status flags
  isRunning: boolean;
  isCompleted: boolean;
  isCancelled: boolean;
  isFailed: boolean | string | null | undefined;
  isInterrupted: boolean | string | null | undefined;
  isExecuting: boolean;
  isParallelExecutionRunning?: boolean;
  hasSubtasks: boolean;
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
 * Always-visible execution section with a context-aware action bar. Mounts
 * ExecutionBody directly beneath the header — this used to be a collapsible
 * accordion, but that hid the run form/logs by default and made this section
 * look sparse next to the task detail page's other always-shown cards
 * (research/plan/verify, preview); always rendering it fixed both.
 *
 * @param props - All derived state and event handlers from the parent component.
 */
export function ExecutionSection({
  capability = 'ready',
  themeId,
  taskId,
  isRunning,
  isCompleted,
  isCancelled,
  isFailed,
  isInterrupted,
  isExecuting,
  isParallelExecutionRunning: _isParallelExecutionRunning,
  hasSubtasks,
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
  // Hide "PRを開く" when the completed task never produced a PR — a button
  // that only errors on click reads as broken (operator feedback).
  const prAvailability = useTaskPrAvailability(taskId, isCompleted);

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
      {/* Header — always visible, no accordion. Matches TaskPreviewSection's
          header exactly (p-4 + border-b + text-lg title). No status label
          next to the title: the running/completed/error state is already
          conveyed by the body content and the action buttons below, and a
          duplicate text badge here was redundant. */}
      <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Rocket className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{t('title')}</h3>
        </div>

        <div className="flex items-center gap-1.5">
          {isRunning && (
            <PillButton
              icon={Square}
              color="zinc"
              onClick={(e) => {
                e.stopPropagation();
                onStop();
              }}
              ariaLabel={t('stopAria')}
            >
              {t('stop')}
            </PillButton>
          )}
          {isCompleted && (
            <>
              <PillButton
                icon={RotateCcw}
                color="zinc"
                iconVariant="plain"
                onClick={(e) => {
                  e.stopPropagation();
                  onReset();
                }}
              >
                {t('reset')}
              </PillButton>
              {prAvailability === 'available' && (
                <PillButton
                  icon={GitPullRequest}
                  color="emerald"
                  iconVariant="plain"
                  onClick={(e) => {
                    e.stopPropagation();
                    openTaskPr();
                  }}
                >
                  {t('openPr')}
                </PillButton>
              )}
            </>
          )}
          {isCancelled && (
            <PillButton
              icon={RefreshCw}
              color="amber"
              iconVariant="plain"
              onClick={(e) => {
                e.stopPropagation();
                onRerun();
              }}
            >
              {t('rerun')}
            </PillButton>
          )}
          {isInterrupted && (
            <>
              <PillButton
                icon={RotateCcw}
                color="zinc"
                iconVariant="plain"
                onClick={(e) => {
                  e.stopPropagation();
                  onReset();
                }}
              >
                {t('reset')}
              </PillButton>
              <PillButton
                icon={RefreshCw}
                color="amber"
                iconVariant="plain"
                onClick={(e) => {
                  e.stopPropagation();
                  onRerun();
                }}
              >
                {t('rerun')}
              </PillButton>
            </>
          )}
          {isFailed && !isRunning && !isCompleted && (
            <>
              <PillButton
                icon={RotateCcw}
                color="zinc"
                iconVariant="plain"
                onClick={(e) => {
                  e.stopPropagation();
                  onReset();
                }}
              >
                {t('reset')}
              </PillButton>
              <PillButton
                icon={RefreshCw}
                color="red"
                iconVariant="plain"
                onClick={(e) => {
                  e.stopPropagation();
                  onRerun();
                }}
              >
                {t('retry')}
              </PillButton>
            </>
          )}
          {!isRunning && !isCompleted && !isCancelled && !isFailed && !isInterrupted && (
            <PillButton
              icon={Play}
              color="indigo"
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
              ariaLabel={t('startExecution')}
            >
              {t('run')}
            </PillButton>
          )}
        </div>
      </div>

      {prError && (
        <div className="px-4 pt-3 flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>{prError}</span>
        </div>
      )}

      {capability !== 'ready' && (
        <div id="execution-section-content" className="p-4 space-y-3">
          <ExecutionCapabilityGuide capability={capability} themeId={themeId} />
        </div>
      )}

      {capability === 'ready' && (
        <div id="execution-section-content" className="p-4 space-y-3">
          <ExecutionBody
            taskId={taskId}
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
