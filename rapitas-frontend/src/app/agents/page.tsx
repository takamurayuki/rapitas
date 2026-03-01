'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Cpu,
  Settings,
  Loader2,
  CheckCircle2,
  XCircle,
  Terminal,
  Zap,
  Activity,
  AlertTriangle,
  Globe,
  Trash2,
} from 'lucide-react';
import type { AIAgentConfig } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { UsageRateLimitGraph } from '@/components/UsageRateLimitGraph';
import WorkflowRolesConfig from '@/components/workflow/WorkflowRolesConfig';

type ModelOption = {
  value: string;
  label: string;
  description?: string;
};

// Cache configuration
const CACHE_KEYS = {
  agents: 'agents-cache',
  agentTypes: 'agent-types-cache',
  models: 'agent-models-cache',
} as const;

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

function getCachedData<T>(key: string): T | null {
  try {
    const cached = localStorage.getItem(key);
    if (!cached) return null;
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp > CACHE_DURATION) {
      localStorage.removeItem(key);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function setCachedData<T>(key: string, data: T): void {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        data,
        timestamp: Date.now(),
      }),
    );
  } catch (error) {
    console.error('Failed to cache data:', error);
  }
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AIAgentConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<
    Record<string, ModelOption[]>
  >({});

  const fetchData = useCallback(async () => {
    try {
      // Check cache first
      const cachedAgents = getCachedData<AIAgentConfig[]>(CACHE_KEYS.agents);
      const cachedModels = getCachedData<Record<string, ModelOption[]>>(
        CACHE_KEYS.models,
      );

      if (cachedAgents && cachedModels) {
        setAgents(cachedAgents);
        setAvailableModels(cachedModels);
        setLoading(false);

        // Fetch in background to update cache
        Promise.all([
          fetch(`${API_BASE_URL}/agents/all`),
          fetch(`${API_BASE_URL}/agents/models`),
        ]).then(async ([agentsRes, modelsRes]) => {
          if (agentsRes.ok) {
            const agentsData = await agentsRes.json();
            setAgents(agentsData);
            setCachedData(CACHE_KEYS.agents, agentsData);
          }
          if (modelsRes.ok) {
            const modelsData = await modelsRes.json();
            setAvailableModels(modelsData);
            setCachedData(CACHE_KEYS.models, modelsData);
          }
        });
        return;
      }

      const [agentsRes, modelsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/agents/all`),
        fetch(`${API_BASE_URL}/agents/models`),
      ]);

      if (agentsRes.ok) {
        const agentsData = await agentsRes.json();
        setAgents(agentsData);
        setCachedData(CACHE_KEYS.agents, agentsData);
      }
      if (modelsRes.ok) {
        const modelsData = await modelsRes.json();
        setAvailableModels(modelsData);
        setCachedData(CACHE_KEYS.models, modelsData);
      }
    } catch (err) {
      console.error('Failed to fetch agents:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const getAgentTypeInfo = (type: string) => {
    const typeInfo: Record<
      string,
      { name: string; icon: React.ReactNode; color: string; bgColor: string }
    > = {
      'claude-code': {
        name: 'Claude Code',
        icon: <Terminal className="w-5 h-5" />,
        color: 'text-orange-500',
        bgColor: 'bg-orange-100 dark:bg-orange-900/30',
      },
      'anthropic-api': {
        name: 'Anthropic API',
        icon: <Terminal className="w-5 h-5" />,
        color: 'text-orange-500',
        bgColor: 'bg-orange-100 dark:bg-orange-900/30',
      },
      codex: {
        name: 'OpenAI Codex',
        icon: <Zap className="w-5 h-5" />,
        color: 'text-green-500',
        bgColor: 'bg-green-100 dark:bg-green-900/30',
      },
      openai: {
        name: 'OpenAI',
        icon: <Zap className="w-5 h-5" />,
        color: 'text-green-500',
        bgColor: 'bg-green-100 dark:bg-green-900/30',
      },
      'azure-openai': {
        name: 'Azure OpenAI',
        icon: <Globe className="w-5 h-5" />,
        color: 'text-blue-500',
        bgColor: 'bg-blue-100 dark:bg-blue-900/30',
      },
      gemini: {
        name: 'Google Gemini',
        icon: <Activity className="w-5 h-5" />,
        color: 'text-blue-500',
        bgColor: 'bg-blue-100 dark:bg-blue-900/30',
      },
      custom: {
        name: 'カスタム',
        icon: <Cpu className="w-5 h-5" />,
        color: 'text-zinc-500',
        bgColor: 'bg-zinc-100 dark:bg-zinc-700',
      },
    };
    return (
      typeInfo[type] || {
        name: type,
        icon: <Cpu className="w-5 h-5" />,
        color: 'text-zinc-500',
        bgColor: 'bg-zinc-100 dark:bg-zinc-700',
      }
    );
  };

  const handleDeleteAgent = async (agentId: number) => {
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return;

    if (!confirm(`エージェント「${agent.name}」を削除しますか？`)) return;

    setDeletingId(agentId);
    setError(null);
    setSuccessMessage(null);
    try {
      const res = await fetch(`${API_BASE_URL}/agents/${agentId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        throw new Error('エージェントの削除に失敗しました');
      }
      setSuccessMessage(`エージェント「${agent.name}」を削除しました`);
      localStorage.removeItem(CACHE_KEYS.agents);
      await fetchData();
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-background scrollbar-thin">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* ヘッダー */}
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                AIエージェント管理
              </h1>
              <p className="text-zinc-500 dark:text-zinc-400 mt-1">
                ワークフローの各フェーズにAIエージェントを割り当て、協調開発を管理します
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/agents/metrics"
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
              >
                <Activity className="w-4 h-4" />
                メトリクス
              </Link>
            </div>
          </div>
        </div>

        {/* エラー・成功表示 */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
            <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
            <button
              onClick={() => setError(null)}
              className="ml-auto text-red-400 hover:text-red-600 dark:hover:text-red-300"
            >
              <XCircle className="w-4 h-4" />
            </button>
          </div>
        )}

        {successMessage && (
          <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0" />
            <p className="text-green-600 dark:text-green-400 text-sm">
              {successMessage}
            </p>
            <button
              onClick={() => setSuccessMessage(null)}
              className="ml-auto text-green-400 hover:text-green-600 dark:hover:text-green-300"
            >
              <XCircle className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 使用制限グラフ */}
        <div className="mb-6">
          <UsageRateLimitGraph />
        </div>

        {/* ワークフローロール設定 */}
        <div className="mb-8">
          <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                ワークフローロール設定
              </h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                各フェーズを担当するAIエージェントとモデルを設定します。成果物（Markdown）をバトンとして渡し、複数のAIが協調して開発を進めます。
              </p>
            </div>
            <div className="p-6">
              <WorkflowRolesConfig agents={agents} availableModels={availableModels} />
            </div>
          </div>
        </div>

        {/* 利用可能なエージェント一覧 */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
            登録済みエージェント
          </h2>
          <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-zinc-200 dark:border-zinc-700">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-xs uppercase text-zinc-500 dark:text-zinc-400">
                      エージェント
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-xs uppercase text-zinc-500 dark:text-zinc-400">
                      モデル
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-xs uppercase text-zinc-500 dark:text-zinc-400">
                      ステータス
                    </th>
                    <th className="text-right px-4 py-3 font-medium text-xs uppercase text-zinc-500 dark:text-zinc-400">
                      アクション
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
                  {agents
                    .filter((agent) => agent.isActive)
                    .map((agent) => {
                      const info = getAgentTypeInfo(agent.agentType);
                      return (
                        <tr
                          key={agent.id}
                          className="hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors"
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div
                                className={`p-2 rounded-lg bg-zinc-100 dark:bg-zinc-700 ${info.color}`}
                              >
                                {info.icon}
                              </div>
                              <div>
                                <p className="font-medium text-zinc-900 dark:text-zinc-100">
                                  {agent.name}
                                </p>
                                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                  {info.name}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm text-zinc-600 dark:text-zinc-300">
                              {agent.modelId || '-'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-1 text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full">
                                アクティブ
                              </span>
                              {agent.isDefault && (
                                <span className="px-2 py-1 text-xs bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-full">
                                  デフォルト
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-2">
                              <Link
                                href={`/agents/${agent.id}/settings`}
                                className="p-1.5 text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors"
                                title="設定"
                              >
                                <Settings className="w-4 h-4" />
                              </Link>
                              <button
                                onClick={() => handleDeleteAgent(agent.id)}
                                disabled={deletingId === agent.id}
                                className="p-1.5 text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
                                title="削除"
                              >
                                {deletingId === agent.id ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Trash2 className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
              {agents.filter((a) => a.isActive).length === 0 && (
                <div className="p-8 text-center text-zinc-500 dark:text-zinc-400">
                  アクティブなエージェントがありません
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 使い方ガイド */}
        <div className="p-6 bg-linear-to-br from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 rounded-lg border border-indigo-200 dark:border-indigo-800">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
            ワークフローの使い方
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex gap-3">
              <div className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 font-medium">
                1
              </div>
              <div>
                <h3 className="font-medium text-zinc-900 dark:text-zinc-100">
                  ロールを設定
                </h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  各フェーズにAIエージェントとモデルを割り当て
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 font-medium">
                2
              </div>
              <div>
                <h3 className="font-medium text-zinc-900 dark:text-zinc-100">
                  タスクで開始
                </h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  タスク詳細でワークフローを開始し、各フェーズを実行
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 font-medium">
                3
              </div>
              <div>
                <h3 className="font-medium text-zinc-900 dark:text-zinc-100">
                  承認して完了
                </h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  計画を承認し実装、検証後にタスクを完了
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
