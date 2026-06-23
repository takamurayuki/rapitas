'use client';
// WorkflowViewer

import { useEffect, useRef, useState } from 'react';
import type { WorkflowFileType, WorkflowStatus } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { useExecutionStateStore } from '@/stores/execution-state-store';
import { type WorkflowMode } from './CompactWorkflowSelector';
import { useWorkflowViewer } from './useWorkflowViewer';
import { getWorkflowTabs } from './workflow-viewer-utils';
import {
  PlanApprovalBanner,
  NextPhaseButton,
  AdvanceErrorBanner,
  FetchErrorBanner,
} from './WorkflowBanners';
import { WorkflowTabBar } from './WorkflowTabBar';
import { WorkflowFileContent } from './WorkflowFileContent';
import { WorkflowQuestionPanel } from './WorkflowQuestionPanel';

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
  onStatusChange,
  onWorkflowModeChange,
  autoApprovePlan = false,
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

  // Live agent question (published by the execution layer). Rendered in the Q&A
  // tab; the interactive prompt was relocated here from the execution log.
  const liveQuestion = useExecutionStateStore((s) => s.liveQuestions.get(taskId) ?? null);
  const markQuestionAnswered = useExecutionStateStore((s) => s.markQuestionAnswered);
  const hasQAtab = workflowTabs.some((t) => t.id === 'question');
  const [submittingAnswer, setSubmittingAnswer] = useState(false);

  // Auto-switch to the Q&A tab ONCE when a question first appears, so the user
  // notices it without losing manual control afterwards.
  const announcedQuestionRef = useRef(false);
  useEffect(() => {
    if (liveQuestion && hasQAtab && !announcedQuestionRef.current) {
      announcedQuestionRef.current = true;
      setActiveTab('question');
    }
    if (!liveQuestion) announcedQuestionRef.current = false;
  }, [liveQuestion, hasQAtab, setActiveTab]);

  /** POST the answer to the agent, then optimistically clear the live question. */
  const handleAnswerQuestion = async (answer: string) => {
    setSubmittingAnswer(true);
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/agent-respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: answer }),
      });
      if (res.ok) markQuestionAnswered(taskId);
    } catch {
      /* leave the question visible so the user can retry */
    } finally {
      setSubmittingAnswer(false);
    }
  };

  /**
   * POST an answer to a workflow QUESTION FILE (the intake gate's question.md),
   * which has no live session to respond to. The backend folds the answer into
   * the spec and re-runs from draft; refetch so the resolved question.md (now
   * archived) disappears.
   */
  const handleAnswerIntakeQuestion = async (answer: string) => {
    setSubmittingAnswer(true);
    try {
      const res = await fetch(`${API_BASE_URL}/workflow/tasks/${taskId}/answer-question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer }),
      });
      if (res.ok) refetch();
    } catch {
      /* leave the question visible so the user can retry */
    } finally {
      setSubmittingAnswer(false);
    }
  };

  // Show the approval banner/button during plan_created — UNLESS auto-approve is
  // effective, in which case the plan is approved automatically and no manual
  // approval prompt should appear.
  const isPlanAwaitingApproval =
    tabStatus.plan &&
    effectiveStatus === 'plan_created' &&
    !!onPlanApprovalRequest &&
    !autoApprovePlan;

  // Approval button within plan tab
  const showApprovalButton = activeTab === 'plan' && isPlanAwaitingApproval;

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

      {/* NOTE: Both the "検証結果を確認" banner and the in-content "実装完了"
          fallback were removed. Verification auto-completes the task on success
          (verify handler in workflow-handlers-files.ts); on failure it is flagged
          for re-verification. Force-completing a verify_done task bypassed the
          completion/verification gate and skipped commit/PR, so it is gone. */}

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
        lastModified={activeFile?.exists ? activeFile.lastModified : undefined}
        onRefetch={refetch}
        isRefetching={isLoading}
      />

      {/* Content area */}
      <div className="p-5">
        {/* Live Q&A: when a question is pending and the Q&A tab is active, the
            interactive prompt renders here (relocated from the execution log). */}
        {validActiveTab === 'question' && liveQuestion && (
          <div className="mb-4">
            <WorkflowQuestionPanel
              question={liveQuestion}
              submitting={submittingAnswer}
              onAnswer={handleAnswerQuestion}
            />
          </div>
        )}
        {/* Intake / spec-clarification question (question.md): answerable even
            though there is no live agent session — the panel was previously
            live-question-only, so an intake question had no answer path. Shown
            when a question.md exists, no live question is pending, and the task
            is not already completed. */}
        {validActiveTab === 'question' &&
          !liveQuestion &&
          tabStatus.question &&
          effectiveStatus !== 'completed' &&
          !!activeFile?.content && (
            <div className="mb-4">
              <WorkflowQuestionPanel
                question={{ taskId, text: activeFile.content, options: [] }}
                submitting={submittingAnswer}
                onAnswer={handleAnswerIntakeQuestion}
              />
            </div>
          )}
        <WorkflowFileContent
          isLoading={isLoading}
          activeFile={activeFile}
          activeTabConfig={activeTabConfig ?? workflowTabs[0]}
          showApprovalButton={!!showApprovalButton}
          onPlanApprovalRequest={onPlanApprovalRequest}
          taskId={taskId}
          onSaved={refetch}
        />
      </div>
    </div>
  );
}
