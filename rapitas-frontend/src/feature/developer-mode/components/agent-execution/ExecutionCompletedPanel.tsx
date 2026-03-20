/**
 * ExecutionCompletedPanel
 *
 * Renders the UI for a successfully completed execution, including the follow-up
 * instruction form and PR creation/merge workflow (via PrMergeSection).
 * Does not manage any state; all values and callbacks are received via props.
 */

'use client';

import React from 'react';
import {
  Play,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  MessageSquarePlus,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import type { PrState } from './agentExecutionTypes';
import { formatTokenCount } from './agentExecutionUtils';
import { PrMergeSection } from './PrMergeSection';

/** Map of workflow session modes to human-readable phase info. */
const WORKFLOW_PHASE_MAP: Record<
  string,
  { title: string; message: string; nextAction: string }
> = {
  'workflow-researcher': {
    title: '調査フェーズ完了',
    message: 'リサーチャーによる調査が完了しました。',
    nextAction: '次は計画フェーズを実行してください。',
  },
  'workflow-planner': {
    title: '計画フェーズ完了',
    message: 'プランナーによる計画作成が完了しました。',
    nextAction: 'ワークフロータブで計画内容を確認し、承認してください。',
  },
  'workflow-reviewer': {
    title: 'レビューフェーズ完了',
    message: 'レビュアーによるレビューが完了しました。',
    nextAction: 'ワークフロータブで計画内容を確認し、承認してください。',
  },
  'workflow-implementer': {
    title: '実装フェーズ完了',
    message: '実装者による実装が完了しました。',
    nextAction: '検証フェーズが自動的に開始されます。しばらくお待ちください。',
  },
  'workflow-verifier': {
    title: '検証フェーズ完了',
    message: '検証者による検証が完了しました。',
    nextAction: 'ワークフロータブで検証結果を確認し、問題なければ完了にしてください。',
  },
};

type Props = {
  /** Current session mode (e.g. "workflow-researcher"), used to render phase info. */
  pollingSessionMode: string | undefined;
  /** Total tokens used in this session. */
  pollingTokensUsed: number | undefined;
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
};

/**
 * Panel shown after a successful execution, with follow-up and PR controls.
 *
 * @param props - See Props type
 */
export function ExecutionCompletedPanel({
  pollingSessionMode,
  pollingTokensUsed,
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
}: Props) {
  const workflowPhaseInfo = pollingSessionMode?.startsWith('workflow-')
    ? (WORKFLOW_PHASE_MAP[pollingSessionMode] ?? null)
    : null;

  return (
    <>
      <div className="bg-linear-to-r from-emerald-50 to-green-50 dark:from-emerald-950/30 dark:to-green-950/30 rounded-xl border border-emerald-200 dark:border-emerald-800 overflow-hidden">
        {/* Header */}
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-emerald-100 dark:bg-emerald-900/40 rounded-xl">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-lg text-zinc-900 dark:text-zinc-50">
                {workflowPhaseInfo?.title || '実行完了'}
              </h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                {workflowPhaseInfo?.message || 'AIエージェントによる実行が完了しました。'}
              </p>
              <p className="text-sm text-emerald-700 dark:text-emerald-300 mt-2">
                {workflowPhaseInfo?.nextAction ||
                  '承認ページでコードレビューを行い、変更をコミットしてください。'}
              </p>
              {(pollingTokensUsed ?? 0) > 0 && (
                <div className="flex items-center gap-1.5 mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                  <Zap className="w-3.5 h-3.5" />
                  <span>{formatTokenCount(pollingTokensUsed ?? 0)}</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onReset}
                className="flex items-center gap-2 px-3 py-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                リセット
              </button>
              <Link
                href="/approvals"
                className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                承認ページへ
              </Link>
            </div>
          </div>
        </div>

        {/* Follow-up instruction section */}
        <div className="px-6 py-4 border-t border-emerald-200 dark:border-emerald-800 bg-white/50 dark:bg-indigo-dark-900/30">
          <div className="flex items-center gap-2 mb-2">
            <MessageSquarePlus className="w-4 h-4 text-violet-600 dark:text-violet-400" />
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              追加の指示を送る
            </span>
          </div>
          <div className="flex items-start gap-2">
            <textarea
              value={followUpInstruction}
              onChange={(e) => setFollowUpInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onFollowUpExecute();
              }}
              placeholder="追加の修正や変更の指示を入力してください..."
              rows={2}
              className="flex-1 px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all resize-none"
            />
            <button
              onClick={onFollowUpExecute}
              disabled={!followUpInstruction.trim() || isExecuting}
              className="flex items-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              <Play className="w-4 h-4" />
              実行
            </button>
          </div>
          <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            Ctrl+Enter で実行
          </p>
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
                    閉じる
                  </button>
                  <button
                    onClick={onFollowUpExecute}
                    disabled={!followUpInstruction.trim() || isExecuting}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <RefreshCw className="w-3 h-3" />
                    再実行
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

        <div className="px-6 py-3 bg-emerald-100/50 dark:bg-emerald-900/20 border-t border-emerald-200 dark:border-emerald-800">
          {logsNode}
        </div>
      </div>
    </>
  );
}
