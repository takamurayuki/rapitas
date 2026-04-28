'use client';

/**
 * WorkflowRoleCard
 *
 * Expandable card for configuring a single workflow role (agent, model, prompt).
 */
import { ChevronDown, Loader2, Save, ArrowDown, ShieldCheck, Cpu } from 'lucide-react';
import type { AIAgentConfig, WorkflowRole, WorkflowRoleConfig } from '@/types';
import { Toggle } from '@/components/ui/Toggle';
import {
  ROLE_CONFIG,
  ROLE_ORDER,
  ROLES_SUPPORTING_CROSS_PROVIDER,
  type ModelOption,
  type SystemPrompt,
  type RoleConfigItem,
} from './workflow-role-constants';

interface WorkflowRoleCardProps {
  roleKey: WorkflowRole;
  index: number;
  config: RoleConfigItem;
  roleData: WorkflowRoleConfig | undefined;
  models: ModelOption[];
  systemPrompts: SystemPrompt[];
  activeAgents: AIAgentConfig[];
  availableModels: Record<string, ModelOption[]>;
  isSaving: boolean;
  isSaved: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onAgentChange: (agentConfigId: number | null) => void;
  onModelChange: (modelId: string | null) => void;
  onPreferredProviderChange: (provider: string | null) => void;
  onPromptChange: (key: string | null) => void;
  onToggleEnabled: (enabled: boolean) => void;
  onManualSetup: (agentConfigId: number, modelId: string) => void;
}

/**
 * Single workflow role card with expandable configuration panel.
 */
export function WorkflowRoleCard({
  roleKey,
  index,
  config,
  roleData,
  models,
  systemPrompts,
  activeAgents,
  availableModels,
  isSaving,
  isSaved,
  isExpanded,
  onToggleExpand,
  onAgentChange,
  onModelChange,
  onPreferredProviderChange,
  onPromptChange,
  onToggleEnabled,
  onManualSetup,
}: WorkflowRoleCardProps) {
  const Icon = config.icon;
  const isEnabled = roleData?.isEnabled !== false;
  const selectedAgent = roleData?.agentConfig;
  const effectiveModelId = roleData?.modelId || selectedAgent?.modelId || null;
  const isAutoSelect = !roleData?.modelId || roleData.modelId === 'auto';

  return (
    <div key={roleKey}>
      {/* Role card */}
      <div
        className={`border ${config.borderColor} rounded-xl overflow-hidden transition-all ${
          !isEnabled ? 'opacity-50' : ''
        }`}
      >
        {/* Header (always visible) */}
        <div
          className={`${config.bgColor} px-4 py-3 cursor-pointer select-none`}
          onClick={onToggleExpand}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Step number */}
              <div
                className={`w-7 h-7 rounded-full ${config.accentColor} flex items-center justify-center text-white text-xs font-bold`}
              >
                {index + 1}
              </div>
              <Icon className={`h-5 w-5 ${config.color}`} />
              <div>
                <span className={`font-semibold ${config.color}`}>{config.label}</span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400 ml-2 hidden sm:inline">
                  {config.description}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Configured agent/mode display */}
              {!isExpanded && (
                <div className="hidden sm:flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300 bg-white/60 dark:bg-zinc-700/60 px-2.5 py-1 rounded-lg">
                  {isAutoSelect ? (
                    <span className="text-indigo-600 dark:text-indigo-400">🤖 自動選択</span>
                  ) : (
                    <>
                      <Cpu className="h-3 w-3" />
                      <span>{selectedAgent?.name ?? '未設定'}</span>
                      <span className="text-zinc-400 dark:text-zinc-500">/ {effectiveModelId}</span>
                    </>
                  )}
                </div>
              )}

              {/* Saving/saved indicator */}
              {isSaving && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
              {isSaved && <Save className="h-4 w-4 text-green-500" />}

              {/* Enable/disable toggle */}
              <Toggle
                checked={isEnabled}
                onChange={(checked) => onToggleEnabled(checked)}
                srLabel={`${config.label}を有効化`}
                stopPropagation
              />

              {/* Expand/collapse icon */}
              <ChevronDown
                className={`h-4 w-4 text-zinc-400 transition-transform ${
                  isExpanded ? 'rotate-180' : ''
                }`}
              />
            </div>
          </div>
        </div>

        {/* Settings panel (expanded) */}
        {isExpanded && (
          <div className="bg-white dark:bg-zinc-800 px-4 py-4 border-t border-zinc-100 dark:border-zinc-700/50">
            {/* Auto-select toggle */}
            <div className="flex items-center justify-between mb-4 p-3 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800">
              <div className="flex items-center gap-2">
                <span className="text-sm">🤖</span>
                <div>
                  <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
                    自動選択モード
                  </span>
                  <p className="text-[10px] text-indigo-600/70 dark:text-indigo-400/70">
                    タスクの複雑度と予算に応じて最適なモデルを自動選択します
                  </p>
                </div>
              </div>
              <Toggle
                checked={isAutoSelect}
                onChange={(checked) => {
                  if (checked) {
                    onModelChange(null);
                    return;
                  }
                  // Toggle OFF: must seed a real modelId
                  const targetAgent = selectedAgent ?? activeAgents[0] ?? null;
                  const targetAgentModels = targetAgent
                    ? (availableModels[targetAgent.agentType] ?? [])
                    : [];
                  const targetModelId = targetAgent?.modelId || targetAgentModels[0]?.value || null;
                  if (!targetModelId || !targetAgent) return;
                  if (!selectedAgent) {
                    onManualSetup(targetAgent.id, targetModelId);
                  } else {
                    onModelChange(targetModelId);
                  }
                }}
                disabled={isSaving}
                srLabel="自動選択モード"
              />
            </div>

            {/* Auto-select provider preference (visible only when auto is on) */}
            {isAutoSelect && (
              <div className="mb-4 p-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
                  優先プロバイダ（同性能ティア時のタイブレーカー）
                </label>
                <div className="relative">
                  <select
                    value={roleData?.preferredProviderOverride ?? ''}
                    onChange={(e) => onPreferredProviderChange(e.target.value || null)}
                    disabled={isSaving}
                    className="w-full appearance-none bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-600 rounded-lg px-3 py-2 pr-8 text-sm text-zinc-900 dark:text-white disabled:opacity-50 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  >
                    <option value="">デフォルト設定に従う</option>
                    <option value="claude">Claude</option>
                    <option value="openai">OpenAI</option>
                    <option value="gemini">Gemini</option>
                    {ROLES_SUPPORTING_CROSS_PROVIDER.has(roleKey) && (
                      <option value="cross-provider">
                        🔀 別プロバイダ（前フェーズと違うものを選ぶ）
                      </option>
                    )}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
                </div>
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1">
                  {ROLES_SUPPORTING_CROSS_PROVIDER.has(roleKey)
                    ? '「別プロバイダ」を選ぶと直前フェーズと異なる AI で評価し、自己バイアスを軽減します'
                    : 'グローバル設定（/settings の「デフォルトAIプロバイダ」）の値を使うか、ロール個別に上書きできます'}
                </p>
              </div>
            )}

            {/* Manual config (hidden when auto-select is on) */}
            {!isAutoSelect && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Agent selector */}
                <div>
                  <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
                    AIエージェント
                  </label>
                  <div className="relative">
                    <select
                      value={roleData?.agentConfigId ?? ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        onAgentChange(val ? parseInt(val) : null);
                      }}
                      disabled={isSaving}
                      className="w-full appearance-none bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-600 rounded-lg px-3 py-2 pr-8 text-sm text-zinc-900 dark:text-white disabled:opacity-50 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    >
                      <option value="">未設定</option>
                      {activeAgents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
                  </div>
                </div>

                {/* Model selector */}
                <div>
                  <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
                    モデル
                  </label>
                  <div className="relative">
                    <select
                      value={roleData?.modelId ?? ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        onModelChange(val || null);
                      }}
                      disabled={isSaving || !selectedAgent || models.length === 0}
                      className="w-full appearance-none bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-600 rounded-lg px-3 py-2 pr-8 text-sm text-zinc-900 dark:text-white disabled:opacity-50 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    >
                      <option value="" disabled>
                        {!selectedAgent
                          ? 'エージェント未選択'
                          : models.length === 0
                            ? '利用可能なモデルなし'
                            : 'モデルを選択'}
                      </option>
                      {models.map((model) => (
                        <option key={model.value} value={model.value}>
                          {model.label}
                          {model.description ? ` - ${model.description}` : ''}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
                  </div>
                </div>

                {/* Prompt selector */}
                <div>
                  <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
                    システムプロンプト
                  </label>
                  <div className="relative">
                    <select
                      value={roleData?.systemPromptKey ?? ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        onPromptChange(val || null);
                      }}
                      disabled={isSaving}
                      className="w-full appearance-none bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-600 rounded-lg px-3 py-2 pr-8 text-sm text-zinc-900 dark:text-white disabled:opacity-50 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    >
                      <option value="">デフォルト</option>
                      {systemPrompts.map((sp) => (
                        <option key={sp.key} value={sp.key}>
                          {sp.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
                  </div>
                </div>
              </div>
            )}

            {/* Flow info */}
            <div className="mt-3 flex items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
              <span>
                入力:{' '}
                <code className="bg-zinc-100 dark:bg-zinc-700 px-1.5 py-0.5 rounded">
                  {config.inputLabel}
                </code>
              </span>
              <span>
                出力:{' '}
                <code className="bg-zinc-100 dark:bg-zinc-700 px-1.5 py-0.5 rounded">
                  {config.outputFile}
                </code>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Baton arrow (except last role) */}
      {index < ROLE_ORDER.length - 1 && (
        <div className="flex items-center justify-center py-1.5">
          <div className="flex items-center gap-2 text-xs text-zinc-400 dark:text-zinc-500">
            <ArrowDown className="h-4 w-4" />
            {index === 2 ? (
              <span className="flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5 text-indigo-500" />
                <span className="text-indigo-500 dark:text-indigo-400 font-medium">
                  ユーザー承認
                </span>
              </span>
            ) : (
              <span>{ROLE_CONFIG[ROLE_ORDER[index]].outputFile}</span>
            )}
            <ArrowDown className="h-4 w-4" />
          </div>
        </div>
      )}
    </div>
  );
}
