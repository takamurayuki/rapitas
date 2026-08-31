'use client';
// ExecutionCompletedPanel

import React, { useState } from 'react';
import {
  Play,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  MessageSquarePlus,
  Zap,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { isImeComposing } from '@/utils/ime';
import { useTaskPrAvailability } from '../../hooks/useTaskPrAvailability';
import type { PrState } from './agent-execution-types';
import { formatTokenCount, formatCostUsd } from './agent-execution-utils';
import { PrMergeSection } from './PrMergeSection';

/** Workflow session modes with a phase-specific translation key. */
const WORKFLOW_PHASE_KEYS: Record<string, string> = {
  'workflow-researcher': 'researcher',
  'workflow-planner': 'planner',
  'workflow-implementer': 'implementer',
  'workflow-verifier': 'verifier',
};

type Props = {
  /** Current session mode (e.g. "workflow-researcher"), used to render phase info. */
  pollingSessionMode: string | undefined;
  /** Total tokens used in this session. */
  pollingTokensUsed: number | undefined;
  /** Accumulated AI cost (USD) across the whole session. */
  pollingTotalSessionCostUsd: number | undefined;
  /** Whether a new execution is in progress (disables follow-up button). */
  isExecuting: boolean;
  /** Current follow-up instruction text. */
  followUpInstruction: string;
  /** Update the follow-up instruction text. */
  setFollowUpInstruction: (v: string) => void;
  /** Error from the last follow-up execution attempt, if any. */
  followUpError: string | null;
  /** Clear the follow-up error. */
  clearFollowUpError: () => void;
  /** Current PR workflow state. */
  prState: PrState;
  /** Reset PR state back to idle. */
  resetPrState: () => void;
  /** Rendered log panel (passed from parent). */
  logsNode: React.ReactNode;
  /** Execute the follow-up instruction. */
  onFollowUpExecute: () => void;
  /** Reset the entire execution panel. */
  onReset: () => void;
  /** Create a PR for this task's branch. */
  onCreatePR: () => void;
  /** Approve and merge the open PR. */
  onApproveMerge: () => void;
  /** Task id — used to open this task's PR detail page. */
  taskId: number;
};

/**
 * Panel shown after a successful execution, with follow-up and PR controls.
 *
 * @param props - See Props type
 */
export function ExecutionCompletedPanel({
  pollingSessionMode,
  pollingTokensUsed,
  pollingTotalSessionCostUsd,
  isExecuting,
  followUpInstruction,
  setFollowUpInstruction,
  followUpError,
  clearFollowUpError,
  prState,
  resetPrState,
  logsNode,
  onFollowUpExecute,
  onReset,
  onCreatePR,
  onApproveMerge,
  taskId,
}: Props) {
  const router = useRouter();
  const t = useTranslations('devMode.executionCompletedPanel');
  const [prError, setPrError] = useState<string | null>(null);
  // Hide "PRを開く" when no PR exists for this task (operator feedback).
  const prAvailability = useTaskPrAvailability(taskId, true);
  const phaseKey =
    pollingSessionMode && pollingSessionMode.startsWith('workflow-')
      ? (WORKFLOW_PHASE_KEYS[pollingSessionMode] ?? null)
      : null;
  const workflowPhaseInfo = phaseKey
    ? {
        title: t(`phases.${phaseKey}.title`),
        message: t(`phases.${phaseKey}.message`),
        nextAction: t(`phases.${phaseKey}.nextAction`),
      }
    : null;

  // Open this task's PR detail page. Replaces the old "承認ページへ" link — the
  // PR is auto-created on completion, so we jump straight to it. If no PR is
  // found yet, hint at the PR-create control below.
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
      // A PR for this task EXISTS on GitHub but isn't synced into the local DB.
      // This is often a PR from an EARLIER completed run (not necessarily this
      // execution), so word it as an existing PR — not a failure — to avoid the
      // "作成されていないように見える" confusion. Open it so the button still acts.
      if (body?.reason === 'not_synced') {
        if (body.prUrl) {
          window.open(body.prUrl, '_blank', 'noopener,noreferrer');
          setPrError(t('prNotSyncedOpened'));
        } else {
          setPrError(body.error ?? t('prNotSynced'));
        }
        return;
      }
      setPrError(body?.error ?? t('prNotCreatedYet'));
    } catch {
      setPrError(t('prFetchFailed'));
    }
  };

  return (
    <>
      <div className="bg-linear-to-r from-green-50 to-green-50 dark:from-green-950/30 dark:to-green-950/30 rounded-xl border border-green-200 dark:border-green-800 overflow-hidden">
        {/* Header */}
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-green-100 dark:bg-green-900/40 rounded-xl">
              <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-lg text-zinc-900 dark:text-zinc-50">
                {workflowPhaseInfo?.title || t('defaultTitle')}
              </h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                {workflowPhaseInfo?.message || t('defaultMessage')}
              </p>
              <p className="text-sm text-green-700 dark:text-green-300 mt-2">
                {workflowPhaseInfo?.nextAction || t('defaultNextAction')}
              </p>
              {prError && (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {prError}
                </p>
              )}
              {(pollingTokensUsed ?? 0) > 0 && (
                <div className="flex items-center gap-3 mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                  <span className="flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" />
                    {formatTokenCount(pollingTokensUsed ?? 0)}
                  </span>
                  {(pollingTotalSessionCostUsd ?? 0) > 0 && (
                    <span>{formatCostUsd(pollingTotalSessionCostUsd ?? 0)}</span>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onReset}
                className="flex items-center gap-2 px-3 py-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                {t('reset')}
              </button>
              {prAvailability === 'available' && (
                <button
                  onClick={openTaskPr}
                  className="flex items-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  {t('openPr')}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Follow-up instruction section */}
        <div className="px-6 py-4 border-t border-green-200 dark:border-green-800 bg-white/50 dark:bg-indigo-dark-900/30">
          <div className="flex items-center gap-2 mb-2">
            <MessageSquarePlus className="w-4 h-4 text-violet-600 dark:text-violet-400" />
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t('followUpLabel')}
            </span>
          </div>
          <div className="flex items-start gap-2">
            <textarea
              value={followUpInstruction}
              onChange={(e) => setFollowUpInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !isImeComposing(e))
                  onFollowUpExecute();
              }}
              placeholder={t('followUpPlaceholder')}
              rows={2}
              className="flex-1 px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg text-sm focus:outline-none focus:border-indigo-400 transition-all resize-none"
            />
            <button
              onClick={onFollowUpExecute}
              disabled={!followUpInstruction.trim() || isExecuting}
              className="flex items-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              <Play className="w-4 h-4" />
              {t('execute')}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">{t('ctrlEnterHint')}</p>
          {followUpError && (
            <div className="mt-2 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {followUpError}
              </p>
              {followUpInstruction.trim() && (
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={clearFollowUpError}
                    className="px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors"
                  >
                    {t('close')}
                  </button>
                  <button
                    onClick={onFollowUpExecute}
                    disabled={!followUpInstruction.trim() || isExecuting}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <RefreshCw className="w-3 h-3" />
                    {t('retryExecution')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <PrMergeSection
          prState={prState}
          resetPrState={resetPrState}
          onCreatePR={onCreatePR}
          onApproveMerge={onApproveMerge}
        />

        <div className="px-6 py-3 bg-green-100/50 dark:bg-green-900/20 border-t border-green-200 dark:border-green-800">
          {logsNode}
        </div>
      </div>
    </>
  );
}
