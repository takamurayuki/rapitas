'use client';
// WorkflowViewer

import { useEffect } from 'react';
import type { WorkflowFileType, WorkflowStatus } from '@/types';
import { FolderOpen, Lock } from 'lucide-react';
import CompactWorkflowSelector, { type WorkflowMode } from './CompactWorkflowSelector';
import { useWorkflowViewer } from './useWorkflowViewer';
import { getWorkflowTabs } from './workflow-viewer-utils';
import {
  PlanApprovalBanner,
  VerifyDoneBanner,
  AsyncExecutionBanner,
  NextPhaseButton,
  AdvanceErrorBanner,
  FetchErrorBanner,
} from './WorkflowBanners';
import { WorkflowTabBar } from './WorkflowTabBar';
import { WorkflowFileContent } from './WorkflowFileContent';

export interface WorkflowViewerProps {
  taskId: number;
  workflowStatus?: WorkflowStatus | null;
  workflowMode?: WorkflowMode | null;
  complexityScore?: number | null;
  workflowModeOverride?: boolean;
  /** Effective state — already OR'd with global UserSettings by the caller. */
  autoApprovePlan?: boolean;
  /** Where the effective ON state originates. Optional informational hint. */
  autoApprovePlanSource?: 'task' | 'global' | 'subtask-global';
  onPlanApprovalRequest?: () => void;
  onCompleteRequest?: () => void;
  onStatusChange?: (newStatus: WorkflowStatus) => void;
  onWorkflowModeChange?: (mode: WorkflowMode, isOverride: boolean) => void;
  showWorkflowMode?: boolean;
  className?: string;
}

export default function WorkflowViewer({
  taskId,
  workflowStatus,
  workflowMode = null,
  complexityScore = null,
  workflowModeOverride = false,
  autoApprovePlan = false,
  autoApprovePlanSource,
  onPlanApprovalRequest,
  onCompleteRequest,
  onStatusChange,
  onWorkflowModeChange,
  showWorkflowMode = true,
  className = '',
}: WorkflowViewerProps) {
  const {
    activeTab,
    setActiveTab,
    files,
    isLoading,
    error,
    refetch,
    workflowPath,
    effectiveStatus,
    isAdvancing,
    advanceError,
    setAdvanceError,
    roles,
    autoComplexityAnalysis,
    isPolling,
    activeFile,
    tabStatus,
    handleAdvance,
    handleAnalysisComplete,
  } = useWorkflowViewer({
    taskId,
    workflowStatus,
    workflowMode,
    onStatusChange,
    onWorkflowModeChange,
    workflowModeOverride,
  });

  const resolvedMode = workflowMode || 'comprehensive';
  const workflowTabs = getWorkflowTabs(resolvedMode);

  // Fallback to first tab if activeTab doesn't exist in current mode
  const validActiveTab = workflowTabs.some((t) => t.id === activeTab)
    ? activeTab
    : (workflowTabs[0]?.id ?? ('research' as WorkflowFileType));

  useEffect(() => {
    if (validActiveTab !== activeTab) {
      setActiveTab(validActiveTab);
    }
  }, [validActiveTab, activeTab, setActiveTab]);

  const activeTabConfig = workflowTabs.find((t) => t.id === validActiveTab)!;

  // Always show approval banner during plan_created
  const isPlanAwaitingApproval =
    tabStatus.plan && effectiveStatus === 'plan_created' && !!onPlanApprovalRequest;

  // Approval button within plan tab
  const showApprovalButton = activeTab === 'plan' && isPlanAwaitingApproval;

  // Complete button display condition (user explicitly completes after verification)
  const showCompleteButton =
    activeTab === 'verify' &&
    tabStatus.verify &&
    effectiveStatus === 'verify_done' &&
    !!onCompleteRequest;

  return (
    <div className={className}>
      {/* Path information */}
      {workflowPath && (
        <div className="flex items-center gap-1.5 px-4 py-2 text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-100 dark:border-zinc-800">
          <FolderOpen className="h-3 w-3" />
          <span>{workflowPath.dir}</span>
        </div>
      )}

      {/* Workflow mode selection section */}
      {showWorkflowMode && (
        <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-100 dark:border-zinc-800">
          <CompactWorkflowSelector
            taskId={taskId}
            currentMode={workflowMode}
            isOverridden={workflowModeOverride}
            complexityScore={complexityScore}
            autoComplexityAnalysis={autoComplexityAnalysis}
            onModeChange={onWorkflowModeChange}
            onAnalysisComplete={handleAnalysisComplete}
            disabled={effectiveStatus === 'in_progress' || effectiveStatus === 'completed'}
            showAnalyzeButton={true}
          />

          {/* Auto-approval status indicator (read-only — managed in task settings) */}
          <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-700">
            <AutoApproveStatusIndicator enabled={autoApprovePlan} source={autoApprovePlanSource} />
          </div>
        </div>
      )}

      {/* Approval pending banner (always shown during plan_created) */}
      {isPlanAwaitingApproval && onPlanApprovalRequest && (
        <PlanApprovalBanner
          onNavigateToPlan={() => setActiveTab('plan')}
          onPlanApprovalRequest={onPlanApprovalRequest}
        />
      )}

      {/* Verification complete banner (shown during verify_done) */}
      {effectiveStatus === 'verify_done' && tabStatus.verify && onCompleteRequest && (
        <VerifyDoneBanner
          onNavigateToVerify={() => setActiveTab('verify')}
          onCompleteRequest={onCompleteRequest}
        />
      )}

      {/* Async execution in progress banner */}
      {isPolling && <AsyncExecutionBanner />}

      {/* Next phase execution button */}
      {effectiveStatus &&
        effectiveStatus !== 'completed' &&
        effectiveStatus !== 'plan_created' &&
        !isPolling && (
          <NextPhaseButton
            effectiveStatus={effectiveStatus}
            workflowMode={resolvedMode as import('./CompactWorkflowSelector').WorkflowMode}
            roles={roles}
            isAdvancing={isAdvancing}
            onAdvance={handleAdvance}
          />
        )}

      {/* Execution error display */}
      {advanceError && (
        <AdvanceErrorBanner error={advanceError} onDismiss={() => setAdvanceError(null)} />
      )}

      {/* Fetch error display */}
      {error && <FetchErrorBanner error={error} isLoading={isLoading} onRefetch={refetch} />}

      {/* Tab header */}
      <WorkflowTabBar
        tabs={workflowTabs}
        activeTab={validActiveTab}
        tabStatus={tabStatus}
        effectiveStatus={effectiveStatus}
        onTabChange={setActiveTab}
      />

      {/* Content area */}
      <div className="p-5">
        <WorkflowFileContent
          isLoading={isLoading}
          activeFile={activeFile}
          activeTabConfig={activeTabConfig ?? workflowTabs[0]}
          showApprovalButton={!!showApprovalButton}
          showCompleteButton={!!showCompleteButton}
          isRefetching={isLoading}
          onRefetch={refetch}
          onPlanApprovalRequest={onPlanApprovalRequest}
          onCompleteRequest={onCompleteRequest}
        />
      </div>
    </div>
  );
}

/**
 * Read-only "auto-approve plan" indicator. The setting itself is owned by the
 * task settings page; here we just surface the *effective* state so users
 * can see at a glance whether plan.md will need manual approval. The
 * effective value should already be the OR of `task.autoApprovePlan`,
 * `userSettings.autoApprovePlan`, and the subtask-specific flag — the
 * caller is responsible for computing it.
 */
function AutoApproveStatusIndicator({
  enabled,
  source,
}: {
  enabled: boolean;
  /** Where the ON state comes from, surfaced as a small tag. */
  source?: 'task' | 'global' | 'subtask-global';
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
        enabled
          ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800/60 dark:bg-emerald-900/20'
          : 'border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/40'
      }`}
      role="status"
      aria-label="計画自動承認の状態"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={`inline-block h-2 w-2 rounded-full shrink-0 ${
            enabled ? 'bg-emerald-500 dark:bg-emerald-400' : 'bg-zinc-300 dark:bg-zinc-600'
          }`}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
              計画自動承認
            </span>
            <span
              className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                enabled
                  ? 'bg-emerald-600 text-white'
                  : 'bg-zinc-300 text-zinc-700 dark:bg-zinc-600 dark:text-zinc-200'
              }`}
            >
              {enabled ? 'ON' : 'OFF'}
            </span>
            {enabled && source && (
              <span className="text-[9px] text-zinc-500 dark:text-zinc-400">
                {source === 'task'
                  ? '（タスク個別設定）'
                  : source === 'subtask-global'
                    ? '（サブタスク用グローバル設定）'
                    : '（グローバル設定）'}
              </span>
            )}
          </div>
          <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5">
            {enabled
              ? 'plan.md 保存時に承認待ちをスキップして自動的に進行します'
              : 'plan.md 保存後に手動で承認が必要です'}
          </p>
        </div>
      </div>
      <span
        className="flex items-center gap-1 text-[10px] text-zinc-400 dark:text-zinc-500 shrink-0"
        title="設定はタスクの設定画面または /settings から変更できます"
      >
        <Lock className="h-2.5 w-2.5" />
        設定で変更
      </span>
    </div>
  );
}
