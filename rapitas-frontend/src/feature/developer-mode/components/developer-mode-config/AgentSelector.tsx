'use client';

/**
 * AgentSelector
 *
 * Dropdown component for selecting an AI agent configuration within the
 * DeveloperModeConfig modal. Displays agent details, supports inline agent
 * creation, and shows an API key setup prompt for agents with unconfigured
 * providers.
 */

import { Loader2, CheckCircle, Plus, Bot } from 'lucide-react';
import type { AIAgentConfig, ApiProvider, ApiKeyStatusMap } from './types';
import { AGENT_TYPE_INFO, CLI_AGENT_TYPES } from './types';
import { InlineAddAgentForm } from './InlineAddAgentForm';
import { InlineApiKeySetup } from './InlineApiKeySetup';

type Props = {
  /** Currently selected agent ID (null = none). / 選択中エージェントID */
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  /** Display list of agents (may be pre-filtered). / 表示するエージェント一覧 */
  agents: AIAgentConfig[];
  /** Full (unfiltered) agent list used for detecting unconfigured-API agents. */
  allAgents: AIAgentConfig[];
  isLoadingAgents: boolean;
  isLoadingApiKeys: boolean;
  /** When true, only agents compatible with configured API keys are shown. */
  filterByApiKey?: boolean;
  isSettingDefault: boolean;
  onSetDefault: (id: number) => void;
  apiKeyStatuses: ApiKeyStatusMap;
  apiKeyProvider: ApiProvider;
  onProviderChange: (p: ApiProvider) => void;
  apiKeyInput: string;
  onApiKeyInputChange: (v: string) => void;
  showApiKey: boolean;
  onShowApiKeyToggle: () => void;
  apiKeyValidationError: string | null;
  apiKeySuccessMessage: string | null;
  isSavingApiKey: boolean;
  onSaveApiKey: () => void;
  onDeleteApiKey: (p: ApiProvider) => void;
  showInlineAddAgent: boolean;
  onToggleInlineAdd: () => void;
  inlineAgentName: string;
  onInlineAgentNameChange: (name: string, error: string | null) => void;
  inlineAgentNameError: string | null;
  inlineAgentType: string;
  onInlineAgentTypeChange: (t: string) => void;
  inlineAgentDefault: boolean;
  onInlineAgentDefaultChange: (v: boolean) => void;
  inlineAgentError: string | null;
  isSavingAgent: boolean;
  onSaveInlineAgent: () => void;
};

/**
 * Returns the icon/color/label info for a given agent type string,
 * falling back to a generic bot icon for unknown types.
 *
 * @param agentType - Agent type identifier string. / エージェント種別識別子
 */
function getAgentTypeInfo(agentType: string) {
  return (
    AGENT_TYPE_INFO[agentType] || {
      icon: Bot,
      color: 'text-zinc-500',
      label: agentType,
    }
  );
}

/**
 * Renders the full agent selection UI including dropdown, inline forms, and
 * API key prompts.
 *
 * @param props - All controlled values and callbacks. / 制御値とコールバック一式
 */
export function AgentSelector({
  selectedId,
  onSelect,
  agents,
  allAgents,
  isLoadingAgents,
  isLoadingApiKeys,
  filterByApiKey = false,
  isSettingDefault,
  onSetDefault,
  apiKeyStatuses,
  apiKeyProvider,
  onProviderChange,
  apiKeyInput,
  onApiKeyInputChange,
  showApiKey,
  onShowApiKeyToggle,
  apiKeyValidationError,
  apiKeySuccessMessage,
  isSavingApiKey,
  onSaveApiKey,
  onDeleteApiKey,
  showInlineAddAgent,
  onToggleInlineAdd,
  inlineAgentName,
  onInlineAgentNameChange,
  inlineAgentNameError,
  inlineAgentType,
  onInlineAgentTypeChange,
  inlineAgentDefault,
  onInlineAgentDefaultChange,
  inlineAgentError,
  isSavingAgent,
  onSaveInlineAgent,
}: Props) {
  const handleCancelInlineAdd = () => {
    onToggleInlineAdd();
  };

  if (isLoadingAgents || isLoadingApiKeys) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        読み込み中...
      </div>
    );
  }

  // No agents at all → show empty state with inline addition.
  if (agents.length === 0 && allAgents.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          エージェントが設定されていません。
        </p>
        {showInlineAddAgent ? (
          <InlineAddAgentForm
            name={inlineAgentName}
            onNameChange={onInlineAgentNameChange}
            nameError={inlineAgentNameError}
            agentType={inlineAgentType}
            onAgentTypeChange={onInlineAgentTypeChange}
            isDefault={inlineAgentDefault}
            onIsDefaultChange={onInlineAgentDefaultChange}
            error={inlineAgentError}
            isSaving={isSavingAgent}
            onSave={onSaveInlineAgent}
            onCancel={handleCancelInlineAdd}
          />
        ) : (
          <button
            onClick={onToggleInlineAdd}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-violet-600 dark:text-violet-400 border border-violet-300 dark:border-violet-700 rounded-lg hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            エージェントを追加
          </button>
        )}
      </div>
    );
  }

  const selectedAgent = agents.find((a) => a.id === selectedId);

  // True when there are agents registered but some are hidden because their
  // API provider is not yet configured.
  const hasUnconfiguredApiKeyAgents =
    filterByApiKey &&
    allAgents.some(
      (agent) =>
        !CLI_AGENT_TYPES.includes(agent.agentType) &&
        !agents.some((da) => da.id === agent.id),
    );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <select
          value={selectedId ?? ''}
          onChange={(e) => {
            const val = e.target.value;
            onSelect(val ? Number(val) : null);
          }}
          className="flex-1 px-3 py-2 bg-white dark:bg-indigo-dark-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
        >
          <option value="">モデルを選択...</option>
          {agents.map((agent) => {
            const typeInfo = getAgentTypeInfo(agent.agentType);
            return (
              <option key={agent.id} value={agent.id}>
                {agent.name} ({typeInfo.label}
                {agent.modelId ? ` · ${agent.modelId}` : ''})
                {agent.isDefault ? ' [デフォルト]' : ''}
              </option>
            );
          })}
        </select>
        <button
          onClick={onToggleInlineAdd}
          className={`flex-shrink-0 p-2 rounded-lg border transition-colors ${
            showInlineAddAgent
              ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400'
              : 'border-zinc-200 dark:border-zinc-700 text-zinc-400 hover:text-violet-600 dark:hover:text-violet-400 hover:border-violet-400 dark:hover:border-violet-500'
          }`}
          title="エージェントを追加"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {showInlineAddAgent && (
        <InlineAddAgentForm
          name={inlineAgentName}
          onNameChange={onInlineAgentNameChange}
          nameError={inlineAgentNameError}
          agentType={inlineAgentType}
          onAgentTypeChange={onInlineAgentTypeChange}
          isDefault={inlineAgentDefault}
          onIsDefaultChange={onInlineAgentDefaultChange}
          error={inlineAgentError}
          isSaving={isSavingAgent}
          onSave={onSaveInlineAgent}
          onCancel={handleCancelInlineAdd}
        />
      )}

      {selectedAgent && (
        <div className="flex items-center gap-2 px-3 py-2 bg-violet-50 dark:bg-violet-900/20 rounded-lg border border-violet-200 dark:border-violet-800">
          {(() => {
            const typeInfo = getAgentTypeInfo(selectedAgent.agentType);
            const TypeIcon = typeInfo.icon;
            return (
              <>
                <TypeIcon
                  className={`w-4 h-4 flex-shrink-0 ${typeInfo.color}`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-violet-700 dark:text-violet-300 truncate">
                      {selectedAgent.name}
                    </span>
                    {selectedAgent.isDefault ? (
                      <span className="px-1.5 py-0.5 bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 rounded text-[10px] font-medium">
                        デフォルト
                      </span>
                    ) : (
                      <button
                        onClick={() => onSetDefault(selectedAgent.id)}
                        disabled={isSettingDefault}
                        className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-violet-600 dark:hover:text-violet-400 border border-zinc-300 dark:border-zinc-600 hover:border-violet-400 dark:hover:border-violet-500 rounded transition-colors disabled:opacity-50"
                      >
                        {isSettingDefault ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <CheckCircle className="w-3 h-3" />
                        )}
                        デフォルトに設定
                      </button>
                    )}
                  </div>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {typeInfo.label}
                    {selectedAgent.modelId && ` · ${selectedAgent.modelId}`}
                  </span>
                </div>
                <CheckCircle className="w-4 h-4 flex-shrink-0 text-violet-500" />
              </>
            );
          })()}
        </div>
      )}

      {hasUnconfiguredApiKeyAgents && (
        <InlineApiKeySetup
          apiKeyStatuses={apiKeyStatuses}
          apiKeyProvider={apiKeyProvider}
          onProviderChange={onProviderChange}
          apiKeyInput={apiKeyInput}
          onApiKeyInputChange={onApiKeyInputChange}
          showApiKey={showApiKey}
          onShowApiKeyToggle={onShowApiKeyToggle}
          validationError={apiKeyValidationError}
          successMessage={apiKeySuccessMessage}
          isSaving={isSavingApiKey}
          onSave={onSaveApiKey}
          onDelete={onDeleteApiKey}
        />
      )}
    </div>
  );
}
