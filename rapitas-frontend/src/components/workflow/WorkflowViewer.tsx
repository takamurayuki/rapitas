'use client';
// WorkflowViewer

import { useEffect } from 'react';
import type { WorkflowFileType, WorkflowStatus } from '@/types';
import { type WorkflowMode } from './CompactWorkflowSelector';
import { useWorkflowViewer } from './useWorkflowViewer';
import { getWorkflowTabs } from './workflow-viewer-utils';
import {
  PlanApprovalBanner,
  VerifyDoneBanner,
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
  workflowModeOverride = false,
  onPlanApprovalRequest,
  onCompleteRequest,
  onStatusChange,
  onWorkflowModeChange,
  className = '',
}: WorkflowViewerProps) {
  const {
    activeTab,
    setActiveTab,
    files,
    isLoading,
    error,
    refetch,
    effectiveStatus,
    isAdvancing,
    advanceError,
    setAdvanceError,
    roles,
    isPolling,
    activeFile,
    tabStatus,
    handleAdvance,
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
      {/* NOTE: The workflow file path (e.g. tasks/1/17) is intentionally not
          shown — it is an internal reference only. workflowPath is still
          provided by useWorkflowViewer for internal use. */}

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

