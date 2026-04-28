'use client';

/**
 * useDeveloperModeConfigModal
 *
 * Root hook for DeveloperModeConfigModal. Composes useAgentManager and
 * useApiKeyManager, then owns the task-analysis and agent-execution form
 * state plus the unified save handler.
 */

import { useState, useEffect } from 'react';
import type { DeveloperModeConfig, TaskAnalysisConfig, AgentExecutionConfig } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import type {
  AnalysisDepth,
  PriorityStrategy,
  PromptStrategy,
  BranchStrategy,
  ReviewScope,
} from './types';
import { useAgentManager } from './useAgentManager';
import { useApiKeyManager } from './useApiKeyManager';

const logger = createLogger('useDeveloperModeConfigModal');

type Params = {
  config: DeveloperModeConfig | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updates: Partial<DeveloperModeConfig>) => Promise<DeveloperModeConfig | null>;
  selectedAgentConfigId?: number | null;
  onAgentConfigChange?: (agentConfigId: number | null) => void;
  taskId?: number;
};

/**
 * Provides all state and handlers needed by DeveloperModeConfigModal.
 *
 * @param params - Props forwarded from the modal component. / モーダルコンポーネントから転送されるprops
 * @returns State values, setters, and async action callbacks. / 状態値・セッター・非同期アクションコールバック
 */
export function useDeveloperModeConfigModal({
  config,
  isOpen,
  onClose,
  onSave,
  selectedAgentConfigId,
  onAgentConfigChange,
  taskId,
}: Params) {
  // ── Composed hooks ────────────────────────────────────────────────────────
  const agentManager = useAgentManager();
  const apiKeyManager = useApiKeyManager();

  // ── General modal state ───────────────────────────────────────────────────
  const [autoApprove, _setAutoApprove] = useState(config?.autoApprove ?? false);
  const [notifyInApp, _setNotifyInApp] = useState(config?.notifyInApp ?? true);
  const [maxSubtasks, _setMaxSubtasks] = useState(config?.maxSubtasks ?? 10);
  const [priority, _setPriority] = useState<string>(config?.priority ?? 'balanced');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Task analysis settings ────────────────────────────────────────────────
  const [analysisAgentConfigId, setAnalysisAgentConfigId] = useState<number | null>(null);
  const [analysisDepth, setAnalysisDepth] = useState<AnalysisDepth>('standard');
  const [analysisMaxSubtasks, setAnalysisMaxSubtasks] = useState(10);
  const [priorityStrategy, setPriorityStrategy] = useState<PriorityStrategy>('balanced');
  const [includeEstimates, setIncludeEstimates] = useState(true);
  const [includeDependencies, setIncludeDependencies] = useState(true);
  const [includeTips, setIncludeTips] = useState(true);
  const [promptStrategy, setPromptStrategy] = useState<PromptStrategy>('auto');
  const [autoApproveSubtasks, setAutoApproveSubtasks] = useState(false);
  const [autoOptimizePrompt, setAutoOptimizePrompt] = useState(false);
  const [analysisNotifyOnComplete, setAnalysisNotifyOnComplete] = useState(true);

  // ── Agent execution settings ──────────────────────────────────────────────
  const [executionAgentConfigId, setExecutionAgentConfigId] = useState<number | null>(null);
  const [branchStrategy, setBranchStrategy] = useState<BranchStrategy>('auto');
  const [branchPrefix, setBranchPrefix] = useState('feature/');
  const [autoCommit, setAutoCommit] = useState(false);
  const [autoCreatePR, setAutoCreatePR] = useState(false);
  const [autoMergePR, setAutoMergePR] = useState(false);
  const [mergeCommitThreshold, setMergeCommitThreshold] = useState(5);
  const [autoExecuteOnAnalysis, setAutoExecuteOnAnalysis] = useState(false);
  const [useOptimizedPrompt, setUseOptimizedPrompt] = useState(true);
  const [autoCodeReview, setAutoCodeReview] = useState(true);
  const [reviewScope, setReviewScope] = useState<ReviewScope>('changes');
  const [execNotifyOnStart, setExecNotifyOnStart] = useState(true);
  const [execNotifyOnComplete, setExecNotifyOnComplete] = useState(true);
  const [execNotifyOnError, setExecNotifyOnError] = useState(true);
  const [additionalInstructions, setAdditionalInstructions] = useState('');

  // Config loading state
  const [isLoadingConfigs, setIsLoadingConfigs] = useState(false);

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (isOpen) {
      apiKeyManager.fetchAllApiKeys();
      agentManager.fetchAgents(
        analysisAgentConfigId,
        setAnalysisAgentConfigId,
        executionAgentConfigId,
        setExecutionAgentConfigId,
      );
      if (taskId) {
        fetchConfigs();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, taskId]);

  // Reflect external selectedAgentConfigId changes into local state.
  useEffect(() => {
    if (selectedAgentConfigId !== undefined && selectedAgentConfigId !== null) {
      if (!analysisAgentConfigId) setAnalysisAgentConfigId(selectedAgentConfigId);
      if (!executionAgentConfigId) setExecutionAgentConfigId(selectedAgentConfigId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAgentConfigId]);

  // ── Data fetching ─────────────────────────────────────────────────────────

  /**
   * Loads task-analysis and agent-execution configs from the backend for the
   * current taskId, then hydrates local state.
   */
  const fetchConfigs = async () => {
    if (!taskId) return;
    setIsLoadingConfigs(true);
    try {
      const [analysisRes, executionRes] = await Promise.all([
        fetch(`${API_BASE_URL}/task-analysis-config/${taskId}`),
        fetch(`${API_BASE_URL}/agent-execution-config/${taskId}`),
      ]);

      if (analysisRes.ok) {
        const data: TaskAnalysisConfig = await analysisRes.json();
        setAnalysisAgentConfigId(data.agentConfigId ?? null);
        setAnalysisDepth(data.analysisDepth);
        setAnalysisMaxSubtasks(data.maxSubtasks);
        setPriorityStrategy(data.priorityStrategy);
        setIncludeEstimates(data.includeEstimates);
        setIncludeDependencies(data.includeDependencies);
        setIncludeTips(data.includeTips);
        setPromptStrategy(data.promptStrategy);
        setAutoApproveSubtasks(data.autoApproveSubtasks);
        setAutoOptimizePrompt(data.autoOptimizePrompt);
        setAnalysisNotifyOnComplete(data.notifyOnComplete);
      }

      if (executionRes.ok) {
        const data: AgentExecutionConfig = await executionRes.json();
        setExecutionAgentConfigId(data.agentConfigId ?? null);
        setBranchStrategy(data.branchStrategy);
        setBranchPrefix(data.branchPrefix);
        setAutoCommit(data.autoCommit);
        setAutoCreatePR(data.autoCreatePR);
        setAutoMergePR(data.autoMergePR ?? false);
        setMergeCommitThreshold(data.mergeCommitThreshold ?? 5);
        setAutoExecuteOnAnalysis(data.autoExecuteOnAnalysis);
        setUseOptimizedPrompt(data.useOptimizedPrompt);
        setAutoCodeReview(data.autoCodeReview);
        setReviewScope(data.reviewScope);
        setExecNotifyOnStart(data.notifyOnStart);
        setExecNotifyOnComplete(data.notifyOnComplete);
        setExecNotifyOnError(data.notifyOnError);
        setAdditionalInstructions(data.additionalInstructions || '');
      }
    } catch (err) {
      logger.error('設定の取得に失敗:', err);
    } finally {
      setIsLoadingConfigs(false);
    }
  };

  // ── Bridged agent actions ─────────────────────────────────────────────────

  /** Proxy that passes current agent-ID state to agentManager.setDefaultAgent. */
  const setDefaultAgent = (agentId: number) =>
    agentManager.setDefaultAgent(
      agentId,
      analysisAgentConfigId,
      setAnalysisAgentConfigId,
      executionAgentConfigId,
      setExecutionAgentConfigId,
    );

  /** Proxy that passes current agent-ID state to agentManager.saveInlineAgent. */
  const saveInlineAgent = () =>
    agentManager.saveInlineAgent(
      analysisAgentConfigId,
      setAnalysisAgentConfigId,
      executionAgentConfigId,
      setExecutionAgentConfigId,
    );

  /** Returns agents filtered by configured API keys. */
  const getAvailableAgents = () => agentManager.getAvailableAgents(apiKeyManager.apiKeyStatuses);

  // ── Save handler ──────────────────────────────────────────────────────────

  /**
   * Persists all settings to the backend: developer mode, task analysis, and
   * agent execution configs. Closes the modal on success.
   */
  const handleSave = async () => {
    setSaveError(null);
    setIsSaving(true);

    try {
      onAgentConfigChange?.(analysisAgentConfigId ?? executionAgentConfigId);
      await onSave({
        autoApprove,
        notifyInApp,
        maxSubtasks,
        priority: priority as DeveloperModeConfig['priority'],
      });

      if (taskId) {
        const analysisRes = await fetch(`${API_BASE_URL}/task-analysis-config/${taskId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentConfigId: analysisAgentConfigId,
            analysisDepth,
            maxSubtasks: analysisMaxSubtasks,
            priorityStrategy,
            includeEstimates,
            includeDependencies,
            includeTips,
            promptStrategy,
            autoApproveSubtasks,
            autoOptimizePrompt,
            notifyOnComplete: analysisNotifyOnComplete,
          }),
        });

        if (!analysisRes.ok) {
          const errData = await analysisRes.json().catch(() => ({}));
          throw new Error(errData.error || 'タスク分析設定の保存に失敗しました');
        }

        const executionRes = await fetch(`${API_BASE_URL}/agent-execution-config/${taskId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentConfigId: executionAgentConfigId,
            branchStrategy,
            branchPrefix,
            autoCommit,
            autoCreatePR,
            autoMergePR,
            mergeCommitThreshold,
            autoExecuteOnAnalysis,
            useOptimizedPrompt,
            autoCodeReview,
            reviewScope,
            notifyOnStart: execNotifyOnStart,
            notifyOnComplete: execNotifyOnComplete,
            notifyOnError: execNotifyOnError,
            additionalInstructions,
          }),
        });

        if (!executionRes.ok) {
          const errData = await executionRes.json().catch(() => ({}));
          throw new Error(errData.error || 'エージェント実行設定の保存に失敗しました');
        }
      }

      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  // ── Public surface ────────────────────────────────────────────────────────

  return {
    // General
    isSaving,
    saveError,
    handleSave,

    // Agent manager (flattened for consumer convenience)
    agents: agentManager.agents,
    isLoadingAgents: agentManager.isLoadingAgents,
    isSettingDefault: agentManager.isSettingDefault,
    setDefaultAgent,
    getAvailableAgents,
    showInlineAddAgent: agentManager.showInlineAddAgent,
    setShowInlineAddAgent: agentManager.setShowInlineAddAgent,
    inlineAgentName: agentManager.inlineAgentName,
    setInlineAgentName: agentManager.setInlineAgentName,
    inlineAgentType: agentManager.inlineAgentType,
    setInlineAgentType: agentManager.setInlineAgentType,
    inlineAgentDefault: agentManager.inlineAgentDefault,
    setInlineAgentDefault: agentManager.setInlineAgentDefault,
    isSavingAgent: agentManager.isSavingAgent,
    inlineAgentError: agentManager.inlineAgentError,
    setInlineAgentError: agentManager.setInlineAgentError,
    inlineAgentNameError: agentManager.inlineAgentNameError,
    setInlineAgentNameError: agentManager.setInlineAgentNameError,
    saveInlineAgent,

    // API key manager (flattened)
    apiKeyStatuses: apiKeyManager.apiKeyStatuses,
    isLoadingApiKeys: apiKeyManager.isLoadingApiKeys,
    apiKeyProvider: apiKeyManager.apiKeyProvider,
    setApiKeyProvider: apiKeyManager.setApiKeyProvider,
    apiKeyInput: apiKeyManager.apiKeyInput,
    setApiKeyInput: apiKeyManager.setApiKeyInput,
    showApiKey: apiKeyManager.showApiKey,
    setShowApiKey: apiKeyManager.setShowApiKey,
    isSavingApiKey: apiKeyManager.isSavingApiKey,
    apiKeyValidationError: apiKeyManager.apiKeyValidationError,
    setApiKeyValidationError: apiKeyManager.setApiKeyValidationError,
    apiKeySuccessMessage: apiKeyManager.apiKeySuccessMessage,
    saveApiKey: apiKeyManager.saveApiKey,
    deleteApiKey: apiKeyManager.deleteApiKey,

    // Config loading
    isLoadingConfigs,

    // Task analysis
    analysisAgentConfigId,
    setAnalysisAgentConfigId,
    analysisDepth,
    setAnalysisDepth,
    analysisMaxSubtasks,
    setAnalysisMaxSubtasks,
    priorityStrategy,
    setPriorityStrategy,
    includeEstimates,
    setIncludeEstimates,
    includeDependencies,
    setIncludeDependencies,
    includeTips,
    setIncludeTips,
    promptStrategy,
    setPromptStrategy,
    autoApproveSubtasks,
    setAutoApproveSubtasks,
    autoOptimizePrompt,
    setAutoOptimizePrompt,
    analysisNotifyOnComplete,
    setAnalysisNotifyOnComplete,

    // Agent execution
    executionAgentConfigId,
    setExecutionAgentConfigId,
    branchStrategy,
    setBranchStrategy,
    branchPrefix,
    setBranchPrefix,
    autoCommit,
    setAutoCommit,
    autoCreatePR,
    setAutoCreatePR,
    autoMergePR,
    setAutoMergePR,
    mergeCommitThreshold,
    setMergeCommitThreshold,
    autoExecuteOnAnalysis,
    setAutoExecuteOnAnalysis,
    useOptimizedPrompt,
    setUseOptimizedPrompt,
    autoCodeReview,
    setAutoCodeReview,
    reviewScope,
    setReviewScope,
    execNotifyOnStart,
    setExecNotifyOnStart,
    execNotifyOnComplete,
    setExecNotifyOnComplete,
    execNotifyOnError,
    setExecNotifyOnError,
    additionalInstructions,
    setAdditionalInstructions,
  };
}
