/**
 * WorkflowBanners
 *
 * Renders contextual status banners for WorkflowViewer: plan-approval pending,
 * verification complete, async-execution in progress, and error notifications.
 * Does not manage any state — all data is passed via props.
 */
'use client';

import {
  ShieldCheck,
  CheckCircle,
  Loader2,
  AlertCircle,
  RefreshCw,
  Play,
} from 'lucide-react';
import type { WorkflowStatus, WorkflowRoleConfig } from '@/types';
import { getStatusToNextRole } from './workflow-viewer-utils';
import type { WorkflowMode } from './CompactWorkflowSelector';
import type { WorkflowFileType } from '@/types';

interface PlanApprovalBannerProps {
  onNavigateToPlan: () => void;
  onPlanApprovalRequest: () => void;
}

/**
 * Banner shown when a plan is awaiting user approval.
 *
 * @param onNavigateToPlan - Switches the active tab to 'plan' / タブを計画に切り替える
 * @param onPlanApprovalRequest - Triggers the approval flow / 承認フローを起動する
 */
export function PlanApprovalBanner({
  onNavigateToPlan,
  onPlanApprovalRequest,
}: PlanApprovalBannerProps) {
  return (
    <div className="flex items-center justify-between px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800/50">
      <div className="flex items-center gap-2.5">
        <div className="p-1.5 bg-amber-100 dark:bg-amber-800/50 rounded-full">
          <ShieldCheck className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        </div>
        <div>
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            計画の承認が必要です
          </p>
          <p className="text-xs text-amber-600 dark:text-amber-400">
            計画タブで内容を確認し、承認すると実装フェーズに移行します
          </p>
        </div>
      </div>
      <button
        onClick={() => {
          onNavigateToPlan();
          onPlanApprovalRequest();
        }}
        className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
      >
        <ShieldCheck className="h-3.5 w-3.5" />
        計画を確認・承認
      </button>
    </div>
  );
}

interface VerifyDoneBannerProps {
  onNavigateToVerify: () => void;
  onCompleteRequest: () => void;
}

/**
 * Banner shown when verification has completed and user action is required.
 *
 * @param onNavigateToVerify - Switches the active tab to 'verify' / タブを検証に切り替える
 * @param onCompleteRequest - Triggers the task-completion flow / タスク完了フローを起動する
 */
export function VerifyDoneBanner({
  onNavigateToVerify,
  onCompleteRequest,
}: VerifyDoneBannerProps) {
  return (
    <div className="flex items-center justify-between px-4 py-3 bg-teal-50 dark:bg-teal-900/20 border-b border-teal-200 dark:border-teal-800/50">
      <div className="flex items-center gap-2.5">
        <div className="p-1.5 bg-teal-100 dark:bg-teal-800/50 rounded-full">
          <CheckCircle className="h-4 w-4 text-teal-600 dark:text-teal-400" />
        </div>
        <div>
          <p className="text-sm font-medium text-teal-800 dark:text-teal-200">
            検証が完了しました
          </p>
          <p className="text-xs text-teal-600 dark:text-teal-400">
            検証タブで内容を確認し、問題なければタスクを完了にしてください
          </p>
        </div>
      </div>
      <button
        onClick={() => {
          onNavigateToVerify();
          onCompleteRequest();
        }}
        className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
      >
        <CheckCircle className="h-3.5 w-3.5" />
        検証結果を確認
      </button>
    </div>
  );
}

/**
 * Banner shown while an async AI agent execution is in progress.
 */
export function AsyncExecutionBanner() {
  return (
    <div className="flex items-center gap-2.5 px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800/50">
      <Loader2 className="h-4 w-4 text-blue-600 dark:text-blue-400 animate-spin" />
      <div>
        <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
          AIエージェントが実行中です...
        </p>
        <p className="text-xs text-blue-600 dark:text-blue-400">
          完了すると自動的に表示が更新されます
        </p>
      </div>
    </div>
  );
}

interface NextPhaseButtonProps {
  effectiveStatus: WorkflowStatus;
  workflowMode: WorkflowMode;
  roles: WorkflowRoleConfig[];
  isAdvancing: boolean;
  onAdvance: () => void;
}

/**
 * Action bar for advancing to the next workflow phase.
 *
 * @param effectiveStatus - Current resolved workflow status
 * @param workflowMode - Active workflow mode (determines next role mapping)
 * @param roles - Loaded role configuration from backend
 * @param isAdvancing - Whether an advance operation is currently in flight
 * @param onAdvance - Callback to trigger the next-phase advance / 次フェーズを実行するコールバック
 */
export function NextPhaseButton({
  effectiveStatus,
  workflowMode,
  roles,
  isAdvancing,
  onAdvance,
}: NextPhaseButtonProps) {
  const statusToNextRole = getStatusToNextRole(workflowMode);
  const next = statusToNextRole[effectiveStatus];
  if (!next) return null;

  const roleConfig = roles.find((r) => r.role === next.role);
  const NextIcon = next.icon;

  return (
    <div className="flex items-center justify-between px-4 py-2.5 bg-indigo-50 dark:bg-indigo-900/20 border-b border-indigo-100 dark:border-indigo-800/50">
      <div className="flex items-center gap-2 text-sm">
        <NextIcon className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
        <span className="text-indigo-700 dark:text-indigo-300 font-medium">
          次: {next.label}
        </span>
        {roleConfig?.agentConfig && (
          <span className="text-xs text-indigo-500 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-800/50 px-2 py-0.5 rounded-full">
            {roleConfig.agentConfig.name}
          </span>
        )}
      </div>
      <button
        onClick={onAdvance}
        disabled={isAdvancing || !roleConfig?.agentConfigId}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
      >
        {isAdvancing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Play className="h-3.5 w-3.5" />
        )}
        {isAdvancing ? '実行中...' : '実行'}
      </button>
    </div>
  );
}

interface AdvanceErrorBannerProps {
  error: string;
  onDismiss: () => void;
}

/**
 * Inline error banner displayed when a phase-advance API call fails.
 *
 * @param error - Error message string to display
 * @param onDismiss - Callback to clear the error / エラーをクリアするコールバック
 */
export function AdvanceErrorBanner({ error, onDismiss }: AdvanceErrorBannerProps) {
  return (
    <div className="bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 px-4 py-2">
      <div className="flex items-center">
        <AlertCircle className="h-4 w-4 text-red-500 mr-2 shrink-0" />
        <span className="text-sm text-red-700 dark:text-red-300">{error}</span>
        <button
          onClick={onDismiss}
          className="ml-auto text-red-400 hover:text-red-600 text-xs"
        >
          閉じる
        </button>
      </div>
    </div>
  );
}

interface FetchErrorBannerProps {
  error: string;
  isLoading: boolean;
  onRefetch: () => void;
}

/**
 * Error banner for workflow file fetch failures.
 *
 * @param error - Error message string to display
 * @param isLoading - Whether a retry is currently in progress
 * @param onRefetch - Retry callback / 再取得コールバック
 */
export function FetchErrorBanner({
  error,
  isLoading,
  onRefetch,
}: FetchErrorBannerProps) {
  return (
    <div className="bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <AlertCircle className="h-4 w-4 text-red-500 mr-2" />
          <span className="text-sm text-red-700 dark:text-red-300">{error}</span>
        </div>
        <button
          onClick={onRefetch}
          disabled={isLoading}
          className="text-red-600 dark:text-red-400 hover:text-red-700 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </div>
  );
}
