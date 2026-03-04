'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Search,
  FileText,
  MessageSquare,
  Code,
  CheckCircle,
  ChevronDown,
  ArrowDown,
  Loader2,
  AlertTriangle,
  ShieldCheck,
  Save,
  Cpu,
} from 'lucide-react';
import type { AIAgentConfig, WorkflowRole } from '@/types';
import { useWorkflowRoles } from '@/hooks/useWorkflowRoles';
import { API_BASE_URL } from '@/utils/api';

type SystemPrompt = {
  key: string;
  name: string;
  category: string;
};

type ModelOption = {
  value: string;
  label: string;
  description?: string;
};

const ROLE_CONFIG: Record<
  WorkflowRole,
  {
    label: string;
    icon: typeof Search;
    color: string;
    bgColor: string;
    borderColor: string;
    accentColor: string;
    outputFile: string;
    description: string;
    inputLabel: string;
  }
> = {
  researcher: {
    label: 'リサーチャー',
    icon: Search,
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
    borderColor: 'border-blue-200 dark:border-blue-800',
    accentColor: 'bg-blue-600',
    outputFile: 'research.md',
    description: 'コードベースを調査し、影響範囲・依存関係を分析',
    inputLabel: 'タスク情報',
  },
  planner: {
    label: 'プランナー',
    icon: FileText,
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-50 dark:bg-amber-900/20',
    borderColor: 'border-amber-200 dark:border-amber-800',
    accentColor: 'bg-amber-600',
    outputFile: 'plan.md',
    description: '調査結果を基にチェックリスト形式の実装計画を作成',
    inputLabel: 'research.md',
  },
  reviewer: {
    label: 'レビュアー',
    icon: MessageSquare,
    color: 'text-purple-600 dark:text-purple-400',
    bgColor: 'bg-purple-50 dark:bg-purple-900/20',
    borderColor: 'border-purple-200 dark:border-purple-800',
    accentColor: 'bg-purple-600',
    outputFile: 'question.md',
    description: '計画のリスク・不明点・改善提案を指摘',
    inputLabel: 'plan.md',
  },
  implementer: {
    label: '実装者',
    icon: Code,
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-50 dark:bg-green-900/20',
    borderColor: 'border-green-200 dark:border-green-800',
    accentColor: 'bg-green-600',
    outputFile: 'コード',
    description: '承認された計画に従いコードを実装',
    inputLabel: 'plan.md + question.md',
  },
  verifier: {
    label: '検証者',
    icon: CheckCircle,
    color: 'text-emerald-600 dark:text-emerald-400',
    bgColor: 'bg-emerald-50 dark:bg-emerald-900/20',
    borderColor: 'border-emerald-200 dark:border-emerald-800',
    accentColor: 'bg-emerald-600',
    outputFile: 'verify.md',
    description: '実装結果を検証しレポートを作成',
    inputLabel: 'plan.md + diff',
  },
};

const ROLE_ORDER: WorkflowRole[] = ['researcher', 'planner', 'reviewer', 'implementer', 'verifier'];

interface WorkflowRolesConfigProps {
  agents: AIAgentConfig[];
  availableModels: Record<string, ModelOption[]>;
}

export default function WorkflowRolesConfig({ agents, availableModels }: WorkflowRolesConfigProps) {
  const { roles, isLoading, error, updateRole } = useWorkflowRoles();
  const [systemPrompts, setSystemPrompts] = useState<SystemPrompt[]>([]);
  const [savingRole, setSavingRole] = useState<WorkflowRole | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<WorkflowRole | null>(null);
  const [expandedRole, setExpandedRole] = useState<WorkflowRole | null>(null);

  // ワークフロー用システムプロンプトを取得
  useEffect(() => {
    const fetchPrompts = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/system-prompts?category=workflow`);
        if (res.ok) {
          const data = await res.json();
          setSystemPrompts(data);
        }
      } catch (err) {
        console.error('Failed to fetch system prompts:', err);
      }
    };
    fetchPrompts();
  }, []);

  const activeAgents = useMemo(() => agents.filter((a) => a.isActive), [agents]);

  const handleAgentChange = async (role: WorkflowRole, agentConfigId: number | null) => {
    setSavingRole(role);
    // エージェント変更時にモデルIDをリセット
    const result = await updateRole(role, { agentConfigId, modelId: null });
    setSavingRole(null);
    if (result.success) {
      setSaveSuccess(role);
      setTimeout(() => setSaveSuccess(null), 2000);
    }
  };

  const handleModelChange = async (role: WorkflowRole, modelId: string | null) => {
    setSavingRole(role);
    const result = await updateRole(role, { modelId });
    setSavingRole(null);
    if (result.success) {
      setSaveSuccess(role);
      setTimeout(() => setSaveSuccess(null), 2000);
    }
  };

  const handlePromptChange = async (role: WorkflowRole, systemPromptKey: string | null) => {
    setSavingRole(role);
    await updateRole(role, { systemPromptKey });
    setSavingRole(null);
  };

  const handleToggleEnabled = async (role: WorkflowRole, isEnabled: boolean) => {
    setSavingRole(role);
    await updateRole(role, { isEnabled });
    setSavingRole(null);
  };

  // 選択中のエージェントに対応するモデル一覧を取得
  const getModelsForRole = (roleKey: WorkflowRole): ModelOption[] => {
    const roleData = roles.find((r) => r.role === roleKey);
    if (!roleData?.agentConfig) return [];
    return availableModels[roleData.agentConfig.agentType] || [];
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
        <span className="ml-2 text-sm text-zinc-500 dark:text-zinc-400">ロール設定を読み込み中...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
        <div className="flex items-center">
          <AlertTriangle className="h-5 w-5 text-red-500 mr-2" />
          <span className="text-sm text-red-700 dark:text-red-300">{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {ROLE_ORDER.map((roleKey, index) => {
        const config = ROLE_CONFIG[roleKey];
        const roleData = roles.find((r) => r.role === roleKey);
        const Icon = config.icon;
        const isSaving = savingRole === roleKey;
        const isSaved = saveSuccess === roleKey;
        const isExpanded = expandedRole === roleKey;
        const models = getModelsForRole(roleKey);
        const isEnabled = roleData?.isEnabled !== false;
        const selectedAgent = roleData?.agentConfig;
        const effectiveModelId = roleData?.modelId || selectedAgent?.modelId || null;

        return (
          <div key={roleKey}>
            {/* ロールカード */}
            <div
              className={`border ${config.borderColor} rounded-xl overflow-hidden transition-all ${
                !isEnabled ? 'opacity-50' : ''
              }`}
            >
              {/* ヘッダー（常に表示） */}
              <div
                className={`${config.bgColor} px-4 py-3 cursor-pointer select-none`}
                onClick={() => setExpandedRole(isExpanded ? null : roleKey)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {/* ステップ番号 */}
                    <div className={`w-7 h-7 rounded-full ${config.accentColor} flex items-center justify-center text-white text-xs font-bold`}>
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
                    {/* 設定済みエージェント表示 */}
                    {selectedAgent && !isExpanded && (
                      <div className="hidden sm:flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300 bg-white/60 dark:bg-zinc-700/60 px-2.5 py-1 rounded-lg">
                        <Cpu className="h-3 w-3" />
                        <span>{selectedAgent.name}</span>
                        {effectiveModelId && (
                          <span className="text-zinc-400 dark:text-zinc-500">/ {effectiveModelId}</span>
                        )}
                      </div>
                    )}

                    {/* 保存中/保存済みインジケーター */}
                    {isSaving && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
                    {isSaved && <Save className="h-4 w-4 text-green-500" />}

                    {/* 有効/無効トグル */}
                    <label
                      className="flex items-center cursor-pointer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={(e) => handleToggleEnabled(roleKey, e.target.checked)}
                        className="sr-only"
                      />
                      <div
                        className={`w-9 h-5 rounded-full transition-colors ${
                          isEnabled
                            ? 'bg-indigo-600'
                            : 'bg-zinc-300 dark:bg-zinc-600'
                        } relative`}
                      >
                        <div
                          className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition-transform ${
                            isEnabled ? 'translate-x-4' : 'translate-x-0.5'
                          }`}
                        />
                      </div>
                    </label>

                    {/* 開閉アイコン */}
                    <ChevronDown
                      className={`h-4 w-4 text-zinc-400 transition-transform ${
                        isExpanded ? 'rotate-180' : ''
                      }`}
                    />
                  </div>
                </div>
              </div>

              {/* 展開時の設定パネル */}
              {isExpanded && (
                <div className="bg-white dark:bg-zinc-800 px-4 py-4 border-t border-zinc-100 dark:border-zinc-700/50">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {/* エージェント選択 */}
                    <div>
                      <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
                        AIエージェント
                      </label>
                      <div className="relative">
                        <select
                          value={roleData?.agentConfigId ?? ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            handleAgentChange(roleKey, val ? parseInt(val) : null);
                          }}
                          disabled={isSaving}
                          className="w-full appearance-none bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-600 rounded-lg px-3 py-2 pr-8 text-sm text-zinc-900 dark:text-white disabled:opacity-50 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        >
                          <option value="">未設定</option>
                          {activeAgents.map((agent) => (
                            <option key={agent.id} value={agent.id}>
                              {agent.name} ({agent.agentType})
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
                      </div>
                    </div>

                    {/* モデル選択 */}
                    <div>
                      <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
                        モデル
                      </label>
                      <div className="relative">
                        <select
                          value={roleData?.modelId ?? ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            handleModelChange(roleKey, val || null);
                          }}
                          disabled={isSaving || !selectedAgent || models.length === 0}
                          className="w-full appearance-none bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-600 rounded-lg px-3 py-2 pr-8 text-sm text-zinc-900 dark:text-white disabled:opacity-50 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        >
                          <option value="">
                            {selectedAgent
                              ? selectedAgent.modelId
                                ? `デフォルト (${selectedAgent.modelId})`
                                : 'デフォルト'
                              : 'エージェント未選択'}
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

                    {/* プロンプト選択 */}
                    <div>
                      <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
                        システムプロンプト
                      </label>
                      <div className="relative">
                        <select
                          value={roleData?.systemPromptKey ?? ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            handlePromptChange(roleKey, val || null);
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

                  {/* フロー情報 */}
                  <div className="mt-3 flex items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
                    <span>
                      入力: <code className="bg-zinc-100 dark:bg-zinc-700 px-1.5 py-0.5 rounded">{config.inputLabel}</code>
                    </span>
                    <span>
                      出力: <code className="bg-zinc-100 dark:bg-zinc-700 px-1.5 py-0.5 rounded">{config.outputFile}</code>
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* バトン矢印（最後のロール以外） */}
            {index < ROLE_ORDER.length - 1 && (
              <div className="flex items-center justify-center py-1.5">
                <div className="flex items-center gap-2 text-xs text-zinc-400 dark:text-zinc-500">
                  <ArrowDown className="h-4 w-4" />
                  {index === 2 ? (
                    <span className="flex items-center gap-1">
                      <ShieldCheck className="h-3.5 w-3.5 text-indigo-500" />
                      <span className="text-indigo-500 dark:text-indigo-400 font-medium">ユーザー承認</span>
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
      })}
    </div>
  );
}
