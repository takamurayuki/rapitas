/**
 * ai-analysis-panel/AIAnalysisPanel.tsx
 *
 * Assembles the AI assistant accordion panel from its sub-components and hooks.
 * Manages top-level tab selection, expand/collapse, and subtask creation flow.
 */

'use client';

import { useState, useEffect } from 'react';
import {
  Bot,
  Wand2,
  ChevronDown,
  ChevronUp,
  Settings,
  CheckCircle2,
  BrainCircuit,
  List,
  GitBranch,
} from 'lucide-react';
import type { DeveloperModeConfig, TaskAnalysisResult } from '@/types';
import { DependencyTree } from '../DependencyTree';
import { ApiKeySetupPrompt } from './ApiKeySetupPrompt';
import { AnalysisTab } from './AnalysisTab';
import { PromptOptimizationTab } from './PromptOptimizationTab';
import { PromptsManagementTab } from './PromptsManagementTab';
import { SettingsTab } from './SettingsTab';
import { useApiKey } from './useApiKey';
import { usePromptOptimization } from './usePromptOptimization';
import { usePromptsManagement } from './usePromptsManagement';
import type { TabType } from './types';

type Props = {
  taskId: number;
  config: DeveloperModeConfig | null;
  isAnalyzing: boolean;
  analysisResult: TaskAnalysisResult | null;
  analysisError: string | null;
  analysisApprovalId: number | null;
  onAnalyze: () => Promise<void>;
  onApprove: (approvalId: number) => Promise<void>;
  onReject: (approvalId: number, reason: string) => Promise<void>;
  onApproveSubtasks: (selectedIndices?: number[]) => Promise<unknown>;
  isApproving: boolean;
  onOpenSettings: () => void;
  onPromptGenerated?: (prompt: string) => void;
  onSubtasksCreated?: () => void;
};

/**
 * Root AI assistant panel component that coordinates all AI-related sub-panels.
 *
 * @param props.taskId - ID of the current task.
 * @param props.config - Developer mode configuration used to gate the analysis CTA.
 * @param props.isAnalyzing - True while a task analysis request is in-flight.
 * @param props.analysisResult - Result object from the last successful analysis.
 * @param props.analysisError - Error message from a failed analysis attempt.
 * @param props.analysisApprovalId - Set when the backend awaits subtask creation approval.
 * @param props.onAnalyze - Triggers a new analysis request.
 * @param props.onApproveSubtasks - Creates subtasks from the analysis result.
 * @param props.isApproving - True while an approval request is in-flight.
 * @param props.onOpenSettings - Opens the developer mode settings modal.
 * @param props.onPromptGenerated - Callback receiving the finalized optimized prompt.
 * @param props.onSubtasksCreated - Callback fired after subtasks are successfully created.
 */
export function AIAnalysisPanel({
  taskId,
  config,
  isAnalyzing,
  analysisResult,
  analysisError,
  analysisApprovalId,
  onAnalyze,
  onApproveSubtasks,
  onOpenSettings,
  onPromptGenerated,
  onSubtasksCreated,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabType>('analysis');
  const [isExpanded, setIsExpanded] = useState(false);

  // Subtask creation state — local because it depends on analysisResult lifecycle.
  const [selectedSubtasks, setSelectedSubtasks] = useState<number[]>([]);
  const [isCreatingSubtasks, setIsCreatingSubtasks] = useState(false);
  const [subtaskCreationSuccess, setSubtaskCreationSuccess] = useState(false);

  const apiKey = useApiKey();
  const promptOpt = usePromptOptimization(taskId, onPromptGenerated);
  const promptsMgmt = usePromptsManagement(taskId);

  // Load saved prompts when switching to the management tab.
  useEffect(() => {
    if (activeTab === 'prompts' && apiKey.isApiKeyConfigured) {
      promptsMgmt.fetchPrompts();
    }
  }, [activeTab, apiKey.isApiKeyConfigured]);

  const handleCreateSubtasks = async () => {
    setIsCreatingSubtasks(true);
    try {
      const result = await onApproveSubtasks(
        selectedSubtasks.length > 0 ? selectedSubtasks : undefined,
      );
      if (result) {
        setSubtaskCreationSuccess(true);
        setSelectedSubtasks([]);
        onSubtasksCreated?.();
      }
    } finally {
      setIsCreatingSubtasks(false);
    }
  };

  const handleToggleSubtask = (index: number) => {
    setSelectedSubtasks((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
    );
  };

  const handleSelectAll = () => {
    const allIndices =
      analysisResult?.suggestedSubtasks?.map((_, i) => i) ?? [];
    if (selectedSubtasks.length === allIndices.length) {
      setSelectedSubtasks([]);
    } else {
      setSelectedSubtasks(allIndices);
    }
  };

  const handleReanalyze = () => {
    setSubtaskCreationSuccess(false);
    setSelectedSubtasks([]);
    onAnalyze();
  };

  if (!apiKey.isApiKeyConfigured) {
    return (
      <ApiKeySetupPrompt
        apiKeyInput={apiKey.apiKeyInput}
        onApiKeyInputChange={apiKey.setApiKeyInput}
        showApiKey={apiKey.showApiKey}
        onToggleShowApiKey={() => apiKey.setShowApiKey(!apiKey.showApiKey)}
        isSavingApiKey={apiKey.isSavingApiKey}
        apiKeyError={apiKey.apiKeyError}
        onSave={apiKey.saveApiKey}
      />
    );
  }

  const tabClass = (tab: TabType) =>
    `flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium transition-colors ${
      activeTab === tab
        ? 'text-violet-600 dark:text-violet-400 border-b-2 border-violet-600 dark:border-violet-400 bg-violet-50 dark:bg-violet-900/10'
        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
    }`;

  return (
    <div className="bg-white dark:bg-indigo-dark-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      {/* Header / accordion toggle */}
      <div
        className="px-4 py-3 bg-linear-to-r from-violet-50 to-indigo-50 dark:from-violet-900/20 dark:to-indigo-900/20 border-b border-zinc-200 dark:border-zinc-700 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BrainCircuit className="w-5 h-5 text-violet-600 dark:text-violet-400" />
            <span className="font-semibold text-zinc-900 dark:text-zinc-50">
              AIアシスタント
            </span>
            <span className="flex items-center gap-1 px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-xs">
              <CheckCircle2 className="w-3 h-3" />
              準備完了
            </span>
          </div>
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-zinc-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-zinc-400" />
          )}
        </div>
      </div>

      {isExpanded && (
        <>
          {/* Tab bar */}
          <div className="flex border-b border-zinc-200 dark:border-zinc-700">
            <button
              onClick={() => setActiveTab('analysis')}
              className={tabClass('analysis')}
            >
              <Bot className="w-4 h-4" />
              分析
            </button>
            <button
              onClick={() => setActiveTab('prompt')}
              className={tabClass('prompt')}
            >
              <Wand2 className="w-4 h-4" />
              最適化
            </button>
            <button
              onClick={() => setActiveTab('prompts')}
              className={tabClass('prompts')}
            >
              <List className="w-4 h-4" />
              管理
            </button>
            <button
              onClick={() => setActiveTab('dependency')}
              className={tabClass('dependency')}
            >
              <GitBranch className="w-4 h-4" />
              依存度
            </button>
            {/* NOTE: Settings tab has no label — icon-only to save horizontal space. */}
            <button
              onClick={() => setActiveTab('settings')}
              className={`flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium transition-colors ${
                activeTab === 'settings'
                  ? 'text-violet-600 dark:text-violet-400 border-b-2 border-violet-600 dark:border-violet-400 bg-violet-50 dark:bg-violet-900/10'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
              }`}
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>

          {/* Tab content */}
          <div className="p-4">
            {activeTab === 'analysis' && (
              <AnalysisTab
                config={config}
                isAnalyzing={isAnalyzing}
                analysisResult={analysisResult}
                analysisError={analysisError}
                analysisApprovalId={analysisApprovalId}
                selectedSubtasks={selectedSubtasks}
                onToggleSubtask={handleToggleSubtask}
                onSelectAll={handleSelectAll}
                isCreatingSubtasks={isCreatingSubtasks}
                subtaskCreationSuccess={subtaskCreationSuccess}
                onCreateSubtasks={handleCreateSubtasks}
                onAnalyze={handleReanalyze}
              />
            )}

            {activeTab === 'prompt' && (
              <PromptOptimizationTab
                isGeneratingPrompt={promptOpt.isGeneratingPrompt}
                promptResult={promptOpt.promptResult}
                setPromptResult={promptOpt.setPromptResult}
                promptError={promptOpt.promptError}
                setPromptError={promptOpt.setPromptError}
                copied={promptOpt.copied}
                promptAnswers={promptOpt.promptAnswers}
                setPromptAnswers={promptOpt.setPromptAnswers}
                isSubmittingAnswers={promptOpt.isSubmittingAnswers}
                onGenerate={() => promptOpt.generatePrompt()}
                onSubmitAnswers={promptOpt.handleSubmitAnswers}
                onCopy={promptOpt.handleCopyPrompt}
                onUse={promptOpt.handleUsePrompt}
              />
            )}

            {activeTab === 'prompts' && (
              <PromptsManagementTab
                promptsData={promptsMgmt.promptsData}
                isLoadingPrompts={promptsMgmt.isLoadingPrompts}
                isGeneratingAll={promptsMgmt.isGeneratingAll}
                editingPromptId={promptsMgmt.editingPromptId}
                editingPromptText={promptsMgmt.editingPromptText}
                onEditingPromptTextChange={promptsMgmt.setEditingPromptText}
                promptsError={promptsMgmt.promptsError}
                onFetchPrompts={promptsMgmt.fetchPrompts}
                onGenerateAll={promptsMgmt.generateAllPrompts}
                onUpdatePrompt={promptsMgmt.updatePrompt}
                onDeletePrompt={promptsMgmt.deletePrompt}
                onStartEditing={promptsMgmt.startEditing}
                onCancelEditing={promptsMgmt.cancelEditing}
              />
            )}

            {activeTab === 'dependency' && <DependencyTree taskId={taskId} />}

            {activeTab === 'settings' && (
              <SettingsTab
                isApiKeyConfigured={apiKey.isApiKeyConfigured}
                maskedApiKey={apiKey.maskedApiKey}
                isEditingApiKey={apiKey.isEditingApiKey}
                onSetIsEditingApiKey={apiKey.setIsEditingApiKey}
                apiKeyInput={apiKey.apiKeyInput}
                onApiKeyInputChange={apiKey.setApiKeyInput}
                showApiKey={apiKey.showApiKey}
                onToggleShowApiKey={() =>
                  apiKey.setShowApiKey(!apiKey.showApiKey)
                }
                isSavingApiKey={apiKey.isSavingApiKey}
                apiKeyError={apiKey.apiKeyError}
                apiKeySuccess={apiKey.apiKeySuccess}
                onSaveApiKey={apiKey.saveApiKey}
                onDeleteApiKey={apiKey.deleteApiKey}
                onOpenSettings={onOpenSettings}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
