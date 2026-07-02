'use client';

/**
 * AgentExecutionTab
 *
 * Renders the "エージェント実行" (agent execution) tab body inside
 * DeveloperModeConfigModal. All state values and setters are received as props.
 */

import { Bot, GitBranch, FileSearch, Play, Bell, FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ToggleSwitch } from './ToggleSwitch';
import { AgentSelector } from './AgentSelector';
import type {
  AIAgentConfig,
  BranchStrategy,
  ReviewScope,
  ApiProvider,
  ApiKeyStatusMap,
} from './types';

type Props = {
  // Agent selector
  executionAgentConfigId: number | null;
  setExecutionAgentConfigId: (id: number | null) => void;
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

  // Execution settings
  branchStrategy: BranchStrategy;
  setBranchStrategy: (v: BranchStrategy) => void;
  branchPrefix: string;
  setBranchPrefix: (v: string) => void;
  autoCommit: boolean;
  setAutoCommit: (v: boolean) => void;
  autoCreatePR: boolean;
  setAutoCreatePR: (v: boolean) => void;
  autoMergePR: boolean;
  setAutoMergePR: (v: boolean) => void;
  mergeCommitThreshold: number;
  setMergeCommitThreshold: (v: number) => void;
  autoExecuteOnAnalysis: boolean;
  setAutoExecuteOnAnalysis: (v: boolean) => void;
  useOptimizedPrompt: boolean;
  setUseOptimizedPrompt: (v: boolean) => void;
  autoCodeReview: boolean;
  setAutoCodeReview: (v: boolean) => void;
  reviewScope: ReviewScope;
  setReviewScope: (v: ReviewScope) => void;
  execNotifyOnStart: boolean;
  setExecNotifyOnStart: (v: boolean) => void;
  execNotifyOnComplete: boolean;
  setExecNotifyOnComplete: (v: boolean) => void;
  execNotifyOnError: boolean;
  setExecNotifyOnError: (v: boolean) => void;
  additionalInstructions: string;
  setAdditionalInstructions: (v: string) => void;
};

/**
 * Renders the agent-execution settings panel including agent selection,
 * Git config, code review, execution options, instructions, and notifications.
 *
 * @param props - All state values and setters for the execution tab. / 実行タブの全状態値とセッター
 */
export function AgentExecutionTab({
  executionAgentConfigId,
  setExecutionAgentConfigId,
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
}: Props) {
  const t = useTranslations('devMode.agentExecutionTab');
  const tCommon = useTranslations('common');
  return (
    <div className="space-y-5">
      {/* Agent selection */}
      <div className="p-3 bg-zinc-50 dark:bg-indigo-dark-800/50 rounded-lg space-y-3">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-violet-500" />
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('executionAgent')}
          </label>
        </div>
        <AgentSelector
          selectedId={executionAgentConfigId}
          onSelect={setExecutionAgentConfigId}
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

      {/* Git settings */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-violet-500" />
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('gitSettings')}
          </label>
        </div>

        <div>
          <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
            {t('branchStrategy')}
          </label>
          <select
            value={branchStrategy}
            onChange={(e) => setBranchStrategy(e.target.value as BranchStrategy)}
            className="w-full px-3 py-2 bg-white dark:bg-indigo-dark-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-indigo-400"
          >
            <option value="auto">{t('branchStrategyAuto')}</option>
            <option value="manual">{t('branchStrategyManual')}</option>
            <option value="none">{tCommon('none')}</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
            {t('branchPrefix')}
          </label>
          <input
            type="text"
            value={branchPrefix}
            onChange={(e) => setBranchPrefix(e.target.value)}
            className="w-full px-3 py-2 bg-white dark:bg-indigo-dark-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-indigo-400"
            placeholder="feature/"
          />
        </div>

        <ToggleSwitch
          value={autoCommit}
          onChange={setAutoCommit}
          label={t('autoCommitLabel')}
          description={t('autoCommitDesc')}
        />
        <ToggleSwitch
          value={autoCreatePR}
          onChange={setAutoCreatePR}
          label={t('autoCreatePRLabel')}
          description={t('autoCreatePRDesc')}
        />

        {autoCreatePR && (
          <>
            <ToggleSwitch
              value={autoMergePR}
              onChange={setAutoMergePR}
              label={t('autoMergeLabel')}
              description={t('autoMergeDesc')}
            />
            {autoMergePR && (
              <div className="ml-4 flex items-center gap-2">
                <label className="text-xs text-zinc-500 dark:text-zinc-400">
                  {t('squashThresholdLabel')}
                </label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={mergeCommitThreshold}
                  onChange={(e) =>
                    setMergeCommitThreshold(Math.max(1, parseInt(e.target.value, 10) || 1))
                  }
                  className="w-16 rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-200"
                />
                <span className="text-xs text-zinc-400 dark:text-zinc-500">
                  {t('squashThresholdSuffix')}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Code review */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <FileSearch className="w-4 h-4 text-violet-500" />
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('codeReview')}
          </label>
        </div>

        <ToggleSwitch
          value={autoCodeReview}
          onChange={setAutoCodeReview}
          label={t('autoCodeReviewLabel')}
          description={t('autoCodeReviewDesc')}
        />

        {autoCodeReview && (
          <div>
            <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
              {t('reviewScopeLabel')}
            </label>
            <select
              value={reviewScope}
              onChange={(e) => setReviewScope(e.target.value as ReviewScope)}
              className="w-full px-3 py-2 bg-white dark:bg-indigo-dark-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-indigo-400"
            >
              <option value="changes">{t('reviewScopeChanges')}</option>
              <option value="full">{t('reviewScopeFull')}</option>
              <option value="none">{tCommon('none')}</option>
            </select>
          </div>
        )}
      </div>

      {/* Execution options */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Play className="w-4 h-4 text-violet-500" />
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('executionOptions')}
          </label>
        </div>
        <ToggleSwitch
          value={autoExecuteOnAnalysis}
          onChange={setAutoExecuteOnAnalysis}
          label={t('autoExecuteLabel')}
          description={t('autoExecuteDesc')}
        />
        <ToggleSwitch
          value={useOptimizedPrompt}
          onChange={setUseOptimizedPrompt}
          label={t('useOptimizedPromptLabel')}
          description={t('useOptimizedPromptDesc')}
        />
      </div>

      {/* Additional instructions */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-violet-500" />
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('executionRules')}
          </label>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('executionRulesDesc')}</p>
        <textarea
          value={additionalInstructions}
          onChange={(e) => setAdditionalInstructions(e.target.value)}
          rows={6}
          className="w-full px-3 py-2 bg-white dark:bg-indigo-dark-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-indigo-400 resize-vertical"
          placeholder={t('executionRulesPlaceholder')}
        />
      </div>

      {/* Notification settings */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-violet-500" />
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('notificationSettings')}
          </label>
        </div>
        <ToggleSwitch
          value={execNotifyOnStart}
          onChange={setExecNotifyOnStart}
          label={t('notifyStartLabel')}
          description={t('notifyStartDesc')}
        />
        <ToggleSwitch
          value={execNotifyOnComplete}
          onChange={setExecNotifyOnComplete}
          label={t('notifyCompleteLabel')}
          description={t('notifyCompleteDesc')}
        />
        <ToggleSwitch
          value={execNotifyOnError}
          onChange={setExecNotifyOnError}
          label={t('notifyErrorLabel')}
          description={t('notifyErrorDesc')}
        />
      </div>
    </div>
  );
}
