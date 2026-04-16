'use client';
// WorkflowViewer

import { useEffect } from 'react';
import type { WorkflowFileType, WorkflowStatus } from '@/types';
import { FolderOpen } from 'lucide-react';
import CompactWorkflowSelector, {
  type WorkflowMode,
} from './CompactWorkflowSelector';
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
  autoApprovePlan?: boolean;
  onPlanApprovalRequest?: () => void;
  onCompleteRequest?: () => void;
  onStatusChange?: (newStatus: WorkflowStatus) => void;
  onWorkflowModeChange?: (mode: WorkflowMode, isOverride: boolean) => void;
  onAutoApprovePlanChange?: (value: boolean) => void;
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
  onPlanApprovalRequest,
  onCompleteRequest,
  onStatusChange,
  onWorkflowModeChange,
  onAutoApprovePlanChange,
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
    tabStatus.plan &&
    effectiveStatus === 'plan_created' &&
    !!onPlanApprovalRequest;

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
            disabled={
              effectiveStatus === 'in_progress' ||
              effectiveStatus === 'completed'
            }
            showAnalyzeButton={true}
          />

          {/* Auto-approval settings for plans */}
          <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-700">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoApprovePlan}
                onChange={(e) => onAutoApprovePlanChange?.(e.target.checked)}
                disabled={
                  effectiveStatus === 'in_progress' ||
                  effectiveStatus === 'completed'
                }
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-800"
              />
              <span className="text-sm text-zinc-700 dark:text-zinc-300">
                計画を自動承認
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                (plan.md保存時に承認待ちをスキップ)
              </span>
            </label>
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
      {effectiveStatus === 'verify_done' &&
        tabStatus.verify &&
        onCompleteRequest && (
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
            workflowMode={
              resolvedMode as import('./CompactWorkflowSelector').WorkflowMode
            }
            roles={roles}
            isAdvancing={isAdvancing}
            onAdvance={handleAdvance}
          />
        )}

      {/* Execution error display */}
      {advanceError && (
        <AdvanceErrorBanner
          error={advanceError}
          onDismiss={() => setAdvanceError(null)}
        />
      )}

      {/* Fetch error display */}
      {error && (
        <FetchErrorBanner
          error={error}
          isLoading={isLoading}
          onRefetch={refetch}
        />
      )}

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
