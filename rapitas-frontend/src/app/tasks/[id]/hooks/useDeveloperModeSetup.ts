/**
 * useDeveloperModeSetup
 *
 * Aggregates developer mode state and the approval flow into a single hook
 * for the task detail page. Extracts the useDeveloperMode + useApprovals
 * wiring from TaskDetailClient to keep the orchestrator under 300 lines.
 */

import { useDeveloperMode } from '@/feature/developer-mode/hooks/useDeveloperMode';
import { useApprovals } from '@/feature/developer-mode/hooks/useApprovals';
import type { DeveloperModeConfig } from '@/types';

export interface UseDeveloperModeSetupResult {
  devModeConfig: DeveloperModeConfig | null;
  devModeLoading: boolean;
  isAnalyzing: boolean;
  isExecuting: boolean;
  executionStatus: unknown;
  executionResult: { error?: string | null } | null;
  analysisResult: unknown;
  analysisApprovalId: number | null;
  analysisError: string | null;
  fetchDevModeConfig: () => void;
  enableDeveloperMode: () => Promise<unknown>;
  updateDevModeConfig: (
    updates: Partial<DeveloperModeConfig>,
  ) => Promise<DeveloperModeConfig | null>;
  analyzeTask: () => Promise<
    { approvalRequestId?: number; autoApproved?: boolean } | null | undefined
  >;
  setAnalysisResult: (result: null) => void;
  executeAgent: (options?: unknown) => Promise<unknown>;
  resetExecutionState: () => void;
  restoreExecutionState: () => Promise<{ status?: string } | null | undefined>;
  approveSubtaskCreation: (...args: unknown[]) => unknown;
  setExecutionCancelled: (...args: unknown[]) => unknown;
  agentConfigId: number | null;
  setAgentConfigId: (id: number | null) => void;
  agents: unknown[];
  fetchAgents: () => void;
  isRestoringState: boolean;
  approveRequest: (
    id: number,
    selectedSubtasks?: number[],
  ) => Promise<{ success?: boolean } | null | undefined>;
  rejectRequest: (id: number) => Promise<unknown>;
  approvalLoading: boolean;
}

/**
 * Wraps useDeveloperMode and useApprovals for the task detail page.
 *
 * @param taskId - Numeric task ID passed to useDeveloperMode.
 * @returns All developer mode and approval state plus action callbacks.
 */
export function useDeveloperModeSetup(taskId: number): UseDeveloperModeSetupResult {
  const {
    config: devModeConfig,
    isLoading: devModeLoading,
    isAnalyzing,
    isExecuting,
    executionStatus,
    executionResult,
    analysisResult,
    analysisApprovalId,
    analysisError,
    fetchConfig: fetchDevModeConfig,
    enableDeveloperMode,
    updateConfig: updateDevModeConfig,
    analyzeTask,
    setAnalysisResult,
    executeAgent,
    resetExecutionState,
    restoreExecutionState,
    approveSubtaskCreation,
    setExecutionCancelled,
    isRestoringState,
    agentConfigId,
    setAgentConfigId,
    agents,
    fetchAgents,
  } = useDeveloperMode(taskId);

  const {
    approve: approveRequest,
    reject: rejectRequest,
    isLoading: approvalLoading,
  } = useApprovals();

  return {
    devModeConfig,
    devModeLoading,
    isAnalyzing,
    isExecuting,
    executionStatus,
    executionResult,
    analysisResult,
    analysisApprovalId,
    analysisError,
    fetchDevModeConfig,
    enableDeveloperMode,
    updateDevModeConfig,
    analyzeTask: analyzeTask as () => Promise<
      { approvalRequestId?: number; autoApproved?: boolean } | null | undefined
    >,
    setAnalysisResult,
    executeAgent: executeAgent as (options?: unknown) => Promise<unknown>,
    resetExecutionState,
    restoreExecutionState,
    approveSubtaskCreation: approveSubtaskCreation as (...args: unknown[]) => unknown,
    setExecutionCancelled,
    agentConfigId,
    setAgentConfigId,
    agents,
    fetchAgents,
    isRestoringState,
    approveRequest,
    rejectRequest,
    approvalLoading,
  };
}
