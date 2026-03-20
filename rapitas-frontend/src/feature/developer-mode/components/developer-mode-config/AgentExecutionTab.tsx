'use client';

/**
 * AgentExecutionTab
 *
 * Renders the "エージェント実行" (agent execution) tab body inside
 * DeveloperModeConfigModal. All state values and setters are received as props.
 */

import { Bot, GitBranch, FileSearch, Play, Bell, FileText } from 'lucide-react';
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
  return (
    <div className="space-y-5">
      {/* Agent selection */}
      <div className="p-3 bg-zinc-50 dark:bg-indigo-dark-800/50 rounded-lg space-y-3">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-violet-500" />
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            実行用AIエージェント
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
            Git設定
          </label>
        </div>

        <div>
          <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
            ブランチ戦略
          </label>
          <select
            value={branchStrategy}
            onChange={(e) => setBranchStrategy(e.target.value as BranchStrategy)}
            className="w-full px-3 py-2 bg-white dark:bg-indigo-dark-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
          >
            <option value="auto">自動（推奨）</option>
            <option value="manual">手動</option>
            <option value="none">なし</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
            ブランチプレフィックス
          </label>
          <input
            type="text"
            value={branchPrefix}
            onChange={(e) => setBranchPrefix(e.target.value)}
            className="w-full px-3 py-2 bg-white dark:bg-indigo-dark-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
            placeholder="feature/"
          />
        </div>

        <ToggleSwitch
          value={autoCommit}
          onChange={setAutoCommit}
          label="自動コミット"
          description="変更を自動的にコミット"
        />
        <ToggleSwitch
          value={autoCreatePR}
          onChange={setAutoCreatePR}
          label="自動PR作成"
          description="完了時にPull Requestを自動作成"
        />

        {autoCreatePR && (
          <>
            <ToggleSwitch
              value={autoMergePR}
              onChange={setAutoMergePR}
              label="自動マージ"
              description="PR作成後に自動でマージ（squash/merge）"
            />
            {autoMergePR && (
              <div className="ml-4 flex items-center gap-2">
                <label className="text-xs text-zinc-500 dark:text-zinc-400">
                  Squashマージ閾値
                </label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={mergeCommitThreshold}
                  onChange={(e) =>
                    setMergeCommitThreshold(
                      Math.max(1, parseInt(e.target.value, 10) || 1),
                    )
                  }
                  className="w-16 rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-200"
                />
                <span className="text-xs text-zinc-400 dark:text-zinc-500">
                  コミット以上でsquash
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
            コードレビュー
          </label>
        </div>

        <ToggleSwitch
          value={autoCodeReview}
          onChange={setAutoCodeReview}
          label="自動コードレビュー"
          description="実行完了後に自動でコードレビュー"
        />

        {autoCodeReview && (
          <div>
            <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
              レビュー範囲
            </label>
            <select
              value={reviewScope}
              onChange={(e) => setReviewScope(e.target.value as ReviewScope)}
              className="w-full px-3 py-2 bg-white dark:bg-indigo-dark-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
            >
              <option value="changes">変更箇所のみ</option>
              <option value="full">全体</option>
              <option value="none">なし</option>
            </select>
          </div>
        )}
      </div>

      {/* Execution options */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Play className="w-4 h-4 text-violet-500" />
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            実行オプション
          </label>
        </div>
        <ToggleSwitch
          value={autoExecuteOnAnalysis}
          onChange={setAutoExecuteOnAnalysis}
          label="分析後自動実行"
          description="タスク分析完了後にエージェントを自動実行"
        />
        <ToggleSwitch
          value={useOptimizedPrompt}
          onChange={setUseOptimizedPrompt}
          label="最適化プロンプト使用"
          description="タスク分析の最適化プロンプトを使用"
        />
      </div>

      {/* Additional instructions */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-violet-500" />
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            実行ルール
          </label>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          エージェント実行時に追加で適用されるルールや指示を設定します
        </p>
        <textarea
          value={additionalInstructions}
          onChange={(e) => setAdditionalInstructions(e.target.value)}
          rows={6}
          className="w-full px-3 py-2 bg-white dark:bg-indigo-dark-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 resize-vertical"
          placeholder="例: ファイルを修正する際は必ずバックアップを作成すること&#10;コミット前に必ずテストを実行すること&#10;セキュリティリスクを慎重に検討すること"
        />
      </div>

      {/* Notification settings */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-violet-500" />
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            通知設定
          </label>
        </div>
        <ToggleSwitch
          value={execNotifyOnStart}
          onChange={setExecNotifyOnStart}
          label="実行開始通知"
          description="エージェント実行開始時に通知"
        />
        <ToggleSwitch
          value={execNotifyOnComplete}
          onChange={setExecNotifyOnComplete}
          label="実行完了通知"
          description="エージェント実行完了時に通知"
        />
        <ToggleSwitch
          value={execNotifyOnError}
          onChange={setExecNotifyOnError}
          label="Error通知"
          description="Error発生時に通知"
        />
      </div>
    </div>
  );
}
