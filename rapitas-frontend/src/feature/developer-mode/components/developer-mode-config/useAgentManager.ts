'use client';

/**
 * useAgentManager
 *
 * Manages the list of AI agent configurations: fetching, setting defaults,
 * and inline creation. Does not handle API key state.
 */

import { useState } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { validateName } from '@/utils/validation';
import { createLogger } from '@/lib/logger';
import type { AIAgentConfig, ApiProvider, ApiKeyStatusMap } from './types';
import { CLI_AGENT_TYPES, PROVIDER_TO_AGENT_TYPES } from './types';

const logger = createLogger('useAgentManager');

/**
 * Provides state and actions for the AI agent list and inline agent creation.
 *
 * @returns Agent list state, loading flags, and mutation callbacks.
 */
export function useAgentManager() {
  const [agents, setAgents] = useState<AIAgentConfig[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [isSettingDefault, setIsSettingDefault] = useState(false);

  // Inline agent addition state
  const [showInlineAddAgent, setShowInlineAddAgent] = useState(false);
  const [inlineAgentName, setInlineAgentName] = useState('');
  const [inlineAgentType, setInlineAgentType] = useState('claude-code');
  const [inlineAgentDefault, setInlineAgentDefault] = useState(false);
  const [isSavingAgent, setIsSavingAgent] = useState(false);
  const [inlineAgentError, setInlineAgentError] = useState<string | null>(null);
  const [inlineAgentNameError, setInlineAgentNameError] = useState<
    string | null
  >(null);

  /**
   * Fetches the full agent list from the backend and returns it.
   * Pre-selects the default agent into the provided setter callbacks when
   * neither analysis nor execution agent is already selected.
   *
   * @param analysisAgentConfigId - Current analysis agent selection. / 現在の分析エージェント選択
   * @param setAnalysisAgentConfigId - Setter for analysis agent selection. / 分析エージェント選択のセッター
   * @param executionAgentConfigId - Current execution agent selection. / 現在の実行エージェント選択
   * @param setExecutionAgentConfigId - Setter for execution agent selection. / 実行エージェント選択のセッター
   */
  const fetchAgents = async (
    analysisAgentConfigId: number | null,
    setAnalysisAgentConfigId: (id: number) => void,
    executionAgentConfigId: number | null,
    setExecutionAgentConfigId: (id: number) => void,
  ) => {
    setIsLoadingAgents(true);
    try {
      const res = await fetch(`${API_BASE_URL}/agents`);
      if (res.ok) {
        const data: AIAgentConfig[] = await res.json();
        setAgents(data);
        const defaultAgent = data.find((a) => a.isDefault);
        if (defaultAgent) {
          if (!analysisAgentConfigId) setAnalysisAgentConfigId(defaultAgent.id);
          if (!executionAgentConfigId)
            setExecutionAgentConfigId(defaultAgent.id);
        }
      }
    } catch (err) {
      logger.error('エージェント一覧の取得に失敗:', err);
    } finally {
      setIsLoadingAgents(false);
    }
  };

  /**
   * Marks the given agent as the default on the backend, then re-fetches
   * the list so the UI reflects the change immediately.
   *
   * @param agentId - Database ID of the agent to promote. / デフォルトに昇格するエージェントID
   * @param analysisAgentConfigId - Forwarded to fetchAgents. / fetchAgentsへの転送値
   * @param setAnalysisAgentConfigId - Forwarded to fetchAgents. / fetchAgentsへの転送値
   * @param executionAgentConfigId - Forwarded to fetchAgents. / fetchAgentsへの転送値
   * @param setExecutionAgentConfigId - Forwarded to fetchAgents. / fetchAgentsへの転送値
   */
  const setDefaultAgent = async (
    agentId: number,
    analysisAgentConfigId: number | null,
    setAnalysisAgentConfigId: (id: number) => void,
    executionAgentConfigId: number | null,
    setExecutionAgentConfigId: (id: number) => void,
  ) => {
    setIsSettingDefault(true);
    try {
      const res = await fetch(`${API_BASE_URL}/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isDefault: true }),
      });
      if (res.ok) {
        await fetchAgents(
          analysisAgentConfigId,
          setAnalysisAgentConfigId,
          executionAgentConfigId,
          setExecutionAgentConfigId,
        );
      } else {
        logger.error('デフォルトエージェントの設定に失敗:', await res.text());
      }
    } catch (err) {
      logger.error('デフォルトエージェントの設定に失敗:', err);
    } finally {
      setIsSettingDefault(false);
    }
  };

  /**
   * Saves a new agent via the inline form, then refreshes the agent list.
   *
   * @param analysisAgentConfigId - Forwarded to fetchAgents. / fetchAgentsへの転送値
   * @param setAnalysisAgentConfigId - Forwarded to fetchAgents. / fetchAgentsへの転送値
   * @param executionAgentConfigId - Forwarded to fetchAgents. / fetchAgentsへの転送値
   * @param setExecutionAgentConfigId - Forwarded to fetchAgents. / fetchAgentsへの転送値
   */
  const saveInlineAgent = async (
    analysisAgentConfigId: number | null,
    setAnalysisAgentConfigId: (id: number) => void,
    executionAgentConfigId: number | null,
    setExecutionAgentConfigId: (id: number) => void,
  ) => {
    setInlineAgentError(null);
    setInlineAgentNameError(null);

    const nameResult = validateName(inlineAgentName, 'エージェント名', 1, 50);
    if (!nameResult.valid) {
      setInlineAgentNameError(nameResult.error ?? null);
      return;
    }

    setIsSavingAgent(true);
    try {
      const res = await fetch(`${API_BASE_URL}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: inlineAgentName,
          agentType: inlineAgentType,
          isDefault: inlineAgentDefault,
        }),
      });

      if (res.ok) {
        setInlineAgentName('');
        setInlineAgentType('claude-code');
        setInlineAgentDefault(false);
        setShowInlineAddAgent(false);
        await fetchAgents(
          analysisAgentConfigId,
          setAnalysisAgentConfigId,
          executionAgentConfigId,
          setExecutionAgentConfigId,
        );
      } else {
        const data = await res.json().catch(() => null);
        setInlineAgentError(data?.error ?? 'エージェントの追加に失敗しました');
      }
    } catch {
      setInlineAgentError('エージェントの追加に失敗しました');
    } finally {
      setIsSavingAgent(false);
    }
  };

  /**
   * Returns the subset of agents that can be used with currently configured
   * API keys. CLI-based agents are always included regardless of key status.
   *
   * @param apiKeyStatuses - Current map of provider → status. / プロバイダーごとのAPI設定状況
   * @returns Filtered agent list. / 使用可能なエージェント一覧
   */
  const getAvailableAgents = (apiKeyStatuses: ApiKeyStatusMap): AIAgentConfig[] => {
    const configuredProviders = (
      Object.keys(apiKeyStatuses) as ApiProvider[]
    ).filter((provider) => apiKeyStatuses[provider].configured);
    const allowedAgentTypes = configuredProviders.flatMap(
      (provider) => PROVIDER_TO_AGENT_TYPES[provider],
    );
    return agents.filter(
      (agent) =>
        CLI_AGENT_TYPES.includes(agent.agentType) ||
        allowedAgentTypes.includes(agent.agentType),
    );
  };

  return {
    agents,
    isLoadingAgents,
    isSettingDefault,
    fetchAgents,
    setDefaultAgent,
    getAvailableAgents,
    showInlineAddAgent,
    setShowInlineAddAgent,
    inlineAgentName,
    setInlineAgentName,
    inlineAgentType,
    setInlineAgentType,
    inlineAgentDefault,
    setInlineAgentDefault,
    isSavingAgent,
    inlineAgentError,
    setInlineAgentError,
    inlineAgentNameError,
    setInlineAgentNameError,
    saveInlineAgent,
  };
}
