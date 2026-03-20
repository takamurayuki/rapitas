/**
 * useDeveloperModeEffects
 *
 * Handles all side-effects related to developer mode auto-enable and
 * AI assistant panel visibility. Extracted from TaskDetailClient to keep
 * the orchestrator under 300 lines.
 */

import { useEffect } from 'react';
import type { Task, UserSettings, DeveloperModeConfig } from '@/types';

export interface UseDeveloperModeEffectsParams {
  resolvedTaskId: string | null | undefined;
  taskId: number;
  task: Task | null;
  globalSettings: UserSettings | null;
  devModeConfig: DeveloperModeConfig | null;
  devModeLoading: boolean;
  isExecuting: boolean;
  executionResult: unknown;
  isParallelExecutionRunning: boolean;
  parallelSessionId: number | null;
  isTaskExecutingInStore: boolean;
  fetchDevModeConfig: () => void;
  fetchAgents: () => void;
  enableDeveloperMode: () => Promise<unknown>;
  setShowAIAssistant: (show: boolean) => void;
}

/**
 * Registers developer mode side-effects: fetches config on mount,
 * auto-enables dev mode from settings, and shows the AI panel when needed.
 *
 * @param params - All dependencies for the three developer mode effects.
 */
export function useDeveloperModeEffects({
  resolvedTaskId,
  taskId,
  task,
  globalSettings,
  devModeConfig,
  devModeLoading,
  isExecuting,
  executionResult,
  isParallelExecutionRunning,
  parallelSessionId,
  isTaskExecutingInStore,
  fetchDevModeConfig,
  fetchAgents,
  enableDeveloperMode,
  setShowAIAssistant,
}: UseDeveloperModeEffectsParams): void {
  // NOTE: Separated from the main data-fetch useEffect to avoid skeleton timer
  // bugs. fetchAgents changes its reference when agentConfigId changes, which
  // would otherwise re-trigger the skeleton timer effect.
  useEffect(() => {
    if (resolvedTaskId) {
      fetchDevModeConfig();
      fetchAgents();
    }
  }, [resolvedTaskId, fetchDevModeConfig, fetchAgents]);

  // Auto-enable developer mode when global settings and task theme require it
  useEffect(() => {
    const autoEnable = async () => {
      if (
        globalSettings?.aiTaskAnalysisDefault &&
        task?.theme?.isDevelopment === true &&
        devModeConfig === null &&
        !devModeLoading &&
        taskId
      ) {
        await enableDeveloperMode();
      }
    };
    autoEnable();
  }, [
    globalSettings,
    task?.theme?.isDevelopment,
    devModeConfig,
    devModeLoading,
    taskId,
    enableDeveloperMode,
  ]);

  // Show AI assistant panel when developer mode is active or execution is ongoing
  useEffect(() => {
    if (
      devModeConfig?.isEnabled === true ||
      isExecuting ||
      executionResult !== null ||
      isParallelExecutionRunning ||
      parallelSessionId !== null ||
      isTaskExecutingInStore
    ) {
      setShowAIAssistant(true);
    }
  }, [
    devModeConfig?.isEnabled,
    isExecuting,
    executionResult,
    isParallelExecutionRunning,
    parallelSessionId,
    isTaskExecutingInStore,
  ]);
}
