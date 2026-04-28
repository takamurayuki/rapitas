'use client';

/**
 * DeveloperModeConfigModal
 *
 * Modal dialog for configuring AI assistant developer-mode settings.
 * Contains two tabs: task-analysis and agent-execution.
 * All business-logic state lives in useDeveloperModeConfigModal; this
 * component handles layout, tab switching, and prop wiring only.
 */

import { useState } from 'react';
import { Bot, X, Save, Loader2, AlertCircle } from 'lucide-react';
import type { ModalProps, TabId } from './types';
import { TABS } from './types';
import { useDeveloperModeConfigModal } from './useDeveloperModeConfigModal';
import { TaskAnalysisTab } from './TaskAnalysisTab';
import { AgentExecutionTab } from './AgentExecutionTab';

/**
 * Renders the full-screen overlay modal for developer-mode AI assistant config.
 *
 * @param props - Controlled open/close state, current config, and save callback.
 *   / モーダルの開閉状態・現在の設定・保存コールバック
 */
export function DeveloperModeConfigModal(props: ModalProps) {
  const { isOpen, onClose } = props;

  // NOTE: activeTab lives here, not in the hook, because it controls only
  // which panel is visible and does not affect any persisted state.
  const [activeTab, setActiveTab] = useState<TabId>('task-analysis');

  const {
    isSaving,
    saveError,
    handleSave,
    agents,
    getAvailableAgents,
    isLoadingAgents,
    isLoadingApiKeys,
    isSettingDefault,
    setDefaultAgent,
    apiKeyStatuses,
    apiKeyProvider,
    setApiKeyProvider,
    apiKeyInput,
    setApiKeyInput,
    showApiKey,
    setShowApiKey,
    apiKeyValidationError,
    setApiKeyValidationError,
    apiKeySuccessMessage,
    isSavingApiKey,
    saveApiKey,
    deleteApiKey,
    showInlineAddAgent,
    setShowInlineAddAgent,
    inlineAgentName,
    setInlineAgentName,
    inlineAgentNameError,
    setInlineAgentNameError,
    inlineAgentType,
    setInlineAgentType,
    inlineAgentDefault,
    setInlineAgentDefault,
    inlineAgentError,
    setInlineAgentError,
    isSavingAgent,
    saveInlineAgent,
    isLoadingConfigs,
    analysisAgentConfigId,
    setAnalysisAgentConfigId,
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
  } = useDeveloperModeConfigModal(props);

  if (!isOpen) return null;

  const availableAgents = getAvailableAgents();

  const handleInlineAgentNameChange = (name: string, error: string | null) => {
    setInlineAgentName(name);
    setInlineAgentNameError(error);
  };

  const handleToggleInlineAdd = () => {
    if (showInlineAddAgent) {
      setInlineAgentError(null);
      setInlineAgentNameError(null);
    }
    setShowInlineAddAgent(!showInlineAddAgent);
  };

  const handleApiKeyInputChange = (v: string) => {
    setApiKeyInput(v);
    if (apiKeyValidationError) setApiKeyValidationError(null);
  };

  // Props shared between both tab panels' AgentSelector instances.
  const sharedAgentProps = {
    agents: availableAgents,
    allAgents: agents,
    isLoadingAgents,
    isLoadingApiKeys,
    isSettingDefault,
    onSetDefault: setDefaultAgent,
    apiKeyStatuses,
    apiKeyProvider,
    onProviderChange: setApiKeyProvider,
    apiKeyInput,
    onApiKeyInputChange: handleApiKeyInputChange,
    showApiKey,
    onShowApiKeyToggle: () => setShowApiKey(!showApiKey),
    apiKeyValidationError,
    apiKeySuccessMessage,
    isSavingApiKey,
    onSaveApiKey: saveApiKey,
    onDeleteApiKey: deleteApiKey,
    showInlineAddAgent,
    onToggleInlineAdd: handleToggleInlineAdd,
    inlineAgentName,
    onInlineAgentNameChange: handleInlineAgentNameChange,
    inlineAgentNameError,
    inlineAgentType,
    onInlineAgentTypeChange: setInlineAgentType,
    inlineAgentDefault,
    onInlineAgentDefaultChange: setInlineAgentDefault,
    inlineAgentError,
    isSavingAgent,
    onSaveInlineAgent: saveInlineAgent,
  } as const;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-indigo-dark-900 rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-violet-100 dark:bg-violet-900/30 rounded-lg">
              <Bot className="w-5 h-5 text-violet-600 dark:text-violet-400" />
            </div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              AIアシスタント設定
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab bar */}
        <div className="px-6 pt-4">
          <div className="flex border-b border-zinc-200 dark:border-zinc-700" role="tablist">
            {TABS.map((tab) => {
              const TabIcon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`tabpanel-${tab.id}`}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    isActive
                      ? 'border-violet-500 text-violet-600 dark:text-violet-400'
                      : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
                  }`}
                >
                  <TabIcon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab panels */}
        <div className="px-6 py-4 max-h-[50vh] overflow-y-auto">
          {isLoadingConfigs ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              設定を読み込み中...
            </div>
          ) : (
            <>
              <div
                role="tabpanel"
                id="tabpanel-task-analysis"
                hidden={activeTab !== 'task-analysis'}
              >
                {activeTab === 'task-analysis' && (
                  <TaskAnalysisTab
                    analysisAgentConfigId={analysisAgentConfigId}
                    setAnalysisAgentConfigId={setAnalysisAgentConfigId}
                    {...sharedAgentProps}
                    analysisDepth={analysisDepth}
                    setAnalysisDepth={setAnalysisDepth}
                    analysisMaxSubtasks={analysisMaxSubtasks}
                    setAnalysisMaxSubtasks={setAnalysisMaxSubtasks}
                    priorityStrategy={priorityStrategy}
                    setPriorityStrategy={setPriorityStrategy}
                    promptStrategy={promptStrategy}
                    setPromptStrategy={setPromptStrategy}
                    includeEstimates={includeEstimates}
                    setIncludeEstimates={setIncludeEstimates}
                    includeDependencies={includeDependencies}
                    setIncludeDependencies={setIncludeDependencies}
                    includeTips={includeTips}
                    setIncludeTips={setIncludeTips}
                    autoApproveSubtasks={autoApproveSubtasks}
                    setAutoApproveSubtasks={setAutoApproveSubtasks}
                    autoOptimizePrompt={autoOptimizePrompt}
                    setAutoOptimizePrompt={setAutoOptimizePrompt}
                    analysisNotifyOnComplete={analysisNotifyOnComplete}
                    setAnalysisNotifyOnComplete={setAnalysisNotifyOnComplete}
                  />
                )}
              </div>
              <div
                role="tabpanel"
                id="tabpanel-agent-execution"
                hidden={activeTab !== 'agent-execution'}
              >
                {activeTab === 'agent-execution' && (
                  <AgentExecutionTab
                    executionAgentConfigId={executionAgentConfigId}
                    setExecutionAgentConfigId={setExecutionAgentConfigId}
                    {...sharedAgentProps}
                    branchStrategy={branchStrategy}
                    setBranchStrategy={setBranchStrategy}
                    branchPrefix={branchPrefix}
                    setBranchPrefix={setBranchPrefix}
                    autoCommit={autoCommit}
                    setAutoCommit={setAutoCommit}
                    autoCreatePR={autoCreatePR}
                    setAutoCreatePR={setAutoCreatePR}
                    autoMergePR={autoMergePR}
                    setAutoMergePR={setAutoMergePR}
                    mergeCommitThreshold={mergeCommitThreshold}
                    setMergeCommitThreshold={setMergeCommitThreshold}
                    autoExecuteOnAnalysis={autoExecuteOnAnalysis}
                    setAutoExecuteOnAnalysis={setAutoExecuteOnAnalysis}
                    useOptimizedPrompt={useOptimizedPrompt}
                    setUseOptimizedPrompt={setUseOptimizedPrompt}
                    autoCodeReview={autoCodeReview}
                    setAutoCodeReview={setAutoCodeReview}
                    reviewScope={reviewScope}
                    setReviewScope={setReviewScope}
                    execNotifyOnStart={execNotifyOnStart}
                    setExecNotifyOnStart={setExecNotifyOnStart}
                    execNotifyOnComplete={execNotifyOnComplete}
                    setExecNotifyOnComplete={setExecNotifyOnComplete}
                    execNotifyOnError={execNotifyOnError}
                    setExecNotifyOnError={setExecNotifyOnError}
                    additionalInstructions={additionalInstructions}
                    setAdditionalInstructions={setAdditionalInstructions}
                  />
                )}
              </div>
            </>
          )}
        </div>

        {/* Save error banner */}
        {saveError && (
          <div className="flex items-center gap-2 px-6 py-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {saveError}
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-indigo-dark-800/50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                保存中...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                設定を保存
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
