'use client';

/**
 * TaskAnalysisTab
 *
 * Renders the "タスク分析" (task analysis) tab body inside DeveloperModeConfigModal.
 * All state values and setters are received as props from the parent modal.
 */

import { Bot } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ToggleSwitch } from './ToggleSwitch';
import { AgentSelector } from './AgentSelector';
import type {
  AIAgentConfig,
  AnalysisDepth,
  PriorityStrategy,
  PromptStrategy,
  ApiProvider,
  ApiKeyStatusMap,
} from './types';
import { PRIORITY_OPTIONS } from './types';

type Props = {
  // Agent selector
  analysisAgentConfigId: number | null;
  setAnalysisAgentConfigId: (id: number | null) => void;
  agents: AIAgentConfig[];
  allAgents: AIAgentConfig[];
  isLoadingAgents: boolean;
  isLoadingApiKeys: boolean;
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

  // Analysis settings
  analysisDepth: AnalysisDepth;
  setAnalysisDepth: (v: AnalysisDepth) => void;
  analysisMaxSubtasks: number;
  setAnalysisMaxSubtasks: (v: number) => void;
  priorityStrategy: PriorityStrategy;
  setPriorityStrategy: (v: PriorityStrategy) => void;
  promptStrategy: PromptStrategy;
  setPromptStrategy: (v: PromptStrategy) => void;
  includeEstimates: boolean;
  setIncludeEstimates: (v: boolean) => void;
  includeDependencies: boolean;
  setIncludeDependencies: (v: boolean) => void;
  includeTips: boolean;
  setIncludeTips: (v: boolean) => void;
  autoApproveSubtasks: boolean;
  setAutoApproveSubtasks: (v: boolean) => void;
  autoOptimizePrompt: boolean;
  setAutoOptimizePrompt: (v: boolean) => void;
  analysisNotifyOnComplete: boolean;
  setAnalysisNotifyOnComplete: (v: boolean) => void;
};

/**
 * Renders the task-analysis settings panel including agent selection,
 * depth/priority/prompt strategy controls, output options, and automation
 * toggles.
 *
 * @param props - All state values and setters for the analysis tab. / 分析タブの全状態値とセッター
 */
export function TaskAnalysisTab({
  analysisAgentConfigId,
  setAnalysisAgentConfigId,
  agents,
  allAgents,
  isLoadingAgents,
  isLoadingApiKeys,
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
  analysisDepth,
  setAnalysisDepth,
  analysisMaxSubtasks,
  setAnalysisMaxSubtasks,
  priorityStrategy,
  setPriorityStrategy,
  promptStrategy,
  setPromptStrategy,
  includeEstimates,
  setIncludeEstimates,
  includeDependencies,
  setIncludeDependencies,
  includeTips,
  setIncludeTips,
  autoApproveSubtasks,
  setAutoApproveSubtasks,
  autoOptimizePrompt,
  setAutoOptimizePrompt,
  analysisNotifyOnComplete,
  setAnalysisNotifyOnComplete,
}: Props) {
  const t = useTranslations('devMode.taskAnalysisTab');
  return (
    <div className="space-y-5">
      {/* Agent selection */}
      <div className="p-3 bg-zinc-50 dark:bg-indigo-dark-800/50 rounded-lg space-y-3">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-violet-500" />
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('agentLabel')}
          </label>
        </div>
        <AgentSelector
          selectedId={analysisAgentConfigId}
          onSelect={setAnalysisAgentConfigId}
          agents={agents}
          allAgents={allAgents}
          isLoadingAgents={isLoadingAgents}
          isLoadingApiKeys={isLoadingApiKeys}
          filterByApiKey
          isSettingDefault={isSettingDefault}
          onSetDefault={onSetDefault}
          apiKeyStatuses={apiKeyStatuses}
          apiKeyProvider={apiKeyProvider}
          onProviderChange={onProviderChange}
          apiKeyInput={apiKeyInput}
          onApiKeyInputChange={onApiKeyInputChange}
          showApiKey={showApiKey}
          onShowApiKeyToggle={onShowApiKeyToggle}
          apiKeyValidationError={apiKeyValidationError}
          apiKeySuccessMessage={apiKeySuccessMessage}
          isSavingApiKey={isSavingApiKey}
          onSaveApiKey={onSaveApiKey}
          onDeleteApiKey={onDeleteApiKey}
          showInlineAddAgent={showInlineAddAgent}
          onToggleInlineAdd={onToggleInlineAdd}
          inlineAgentName={inlineAgentName}
          onInlineAgentNameChange={onInlineAgentNameChange}
          inlineAgentNameError={inlineAgentNameError}
          inlineAgentType={inlineAgentType}
          onInlineAgentTypeChange={onInlineAgentTypeChange}
          inlineAgentDefault={inlineAgentDefault}
          onInlineAgentDefaultChange={onInlineAgentDefaultChange}
          inlineAgentError={inlineAgentError}
          isSavingAgent={isSavingAgent}
          onSaveInlineAgent={onSaveInlineAgent}
        />
      </div>

      {/* Analysis depth */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          {t('depthLabel')}
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {(
            [
              {
                value: 'quick' as const,
                label: t('depth.quick.label'),
                desc: t('depth.quick.desc'),
              },
              {
                value: 'standard' as const,
                label: t('depth.standard.label'),
                desc: t('depth.standard.desc'),
              },
              { value: 'deep' as const, label: t('depth.deep.label'), desc: t('depth.deep.desc') },
            ] satisfies { value: AnalysisDepth; label: string; desc: string }[]
          ).map((opt) => (
            <button
              key={opt.value}
              onClick={() => setAnalysisDepth(opt.value)}
              className={`p-2.5 rounded-lg border text-center transition-all ${
                analysisDepth === opt.value
                  ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20'
                  : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
              }`}
            >
              <span
                className={`text-sm font-medium ${
                  analysisDepth === opt.value
                    ? 'text-violet-700 dark:text-violet-300'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                {opt.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Priority strategy */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          {t('priorityLabel')}
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {PRIORITY_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => setPriorityStrategy(option.value as PriorityStrategy)}
              className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border transition-all ${
                priorityStrategy === option.value
                  ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20'
                  : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
              }`}
            >
              <option.icon
                className={`w-4 h-4 ${
                  priorityStrategy === option.value
                    ? 'text-violet-600 dark:text-violet-400'
                    : 'text-zinc-400'
                }`}
              />
              <span
                className={`text-xs font-medium ${
                  priorityStrategy === option.value
                    ? 'text-violet-700 dark:text-violet-300'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                {t(option.labelKey)}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {(() => {
            const descKey = PRIORITY_OPTIONS.find(
              (o) => o.value === priorityStrategy,
            )?.descriptionKey;
            return descKey ? t(descKey) : null;
          })()}
        </p>
      </div>

      {/* Prompt strategy */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          {t('promptStrategyLabel')}
        </label>
        <select
          value={promptStrategy}
          onChange={(e) => setPromptStrategy(e.target.value as PromptStrategy)}
          className="w-full px-3 py-2 bg-white dark:bg-indigo-dark-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-indigo-400"
        >
          <option value="auto">{t('promptStrategy.auto')}</option>
          <option value="detailed">{t('promptStrategy.detailed')}</option>
          <option value="concise">{t('promptStrategy.concise')}</option>
          <option value="custom">{t('promptStrategy.custom')}</option>
        </select>
      </div>

      {/* Max subtasks slider */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          {t('maxSubtasksLabel', { count: analysisMaxSubtasks })}
        </label>
        <input
          type="range"
          min={3}
          max={20}
          value={analysisMaxSubtasks}
          onChange={(e) => setAnalysisMaxSubtasks(parseInt(e.target.value))}
          className="w-full h-2 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-violet-500"
        />
        <div className="flex justify-between text-xs text-zinc-500 mt-1">
          <span>3</span>
          <span>20</span>
        </div>
      </div>

      {/* Output options */}
      <div className="space-y-3">
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {t('outputOptionsLabel')}
        </label>
        <ToggleSwitch
          value={includeEstimates}
          onChange={setIncludeEstimates}
          label={t('outputOptions.estimates.label')}
          description={t('outputOptions.estimates.description')}
        />
        <ToggleSwitch
          value={includeDependencies}
          onChange={setIncludeDependencies}
          label={t('outputOptions.dependencies.label')}
          description={t('outputOptions.dependencies.description')}
        />
        <ToggleSwitch
          value={includeTips}
          onChange={setIncludeTips}
          label={t('outputOptions.tips.label')}
          description={t('outputOptions.tips.description')}
        />
      </div>

      {/* Automation */}
      <div className="space-y-3">
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {t('automationLabel')}
        </label>
        <ToggleSwitch
          value={autoApproveSubtasks}
          onChange={setAutoApproveSubtasks}
          label={t('automation.autoApproveSubtasks.label')}
          description={t('automation.autoApproveSubtasks.description')}
        />
        <ToggleSwitch
          value={autoOptimizePrompt}
          onChange={setAutoOptimizePrompt}
          label={t('automation.autoOptimizePrompt.label')}
          description={t('automation.autoOptimizePrompt.description')}
        />
        <ToggleSwitch
          value={analysisNotifyOnComplete}
          onChange={setAnalysisNotifyOnComplete}
          label={t('automation.notifyOnComplete.label')}
          description={t('automation.notifyOnComplete.description')}
        />
      </div>
    </div>
  );
}
