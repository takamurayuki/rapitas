"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Cpu,
  Plus,
  Settings,
  Loader2,
  CheckCircle2,
  XCircle,
  Terminal,
  Zap,
  Activity,
} from "lucide-react";
import type { AIAgentConfig } from "@/types";
import { API_BASE_URL } from "@/utils/api";

export default function AgentsPage() {
  const [agents, setAgents] = useState<AIAgentConfig[]>([]);
  const [agentTypes, setAgentTypes] = useState<{
    registered: Array<{
      type: string;
      name: string;
      description?: string;
      capabilities?: {
        codeGeneration?: boolean;
        codeReview?: boolean;
        taskAnalysis?: boolean;
        fileOperations?: boolean;
        terminalAccess?: boolean;
        gitOperations?: boolean;
        webSearch?: boolean;
      };
    }>;
    available: string[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [agentsRes, typesRes] = await Promise.all([
        fetch(`${API_BASE_URL}/agents`),
        fetch(`${API_BASE_URL}/agents/types`),
      ]);

      if (agentsRes.ok) {
        setAgents(await agentsRes.json());
      }
      if (typesRes.ok) {
        setAgentTypes(await typesRes.json());
      }
    } catch (error) {
      console.error("Failed to fetch agents:", error);
    } finally {
      setLoading(false);
    }
  };

  const getAgentTypeInfo = (type: string) => {
    const typeInfo: Record<
      string,
      { name: string; icon: React.ReactNode; color: string }
    > = {
      "claude-code": {
        name: "Claude Code",
        icon: <Terminal className="w-5 h-5" />,
        color: "text-orange-500",
      },
      codex: {
        name: "OpenAI Codex",
        icon: <Zap className="w-5 h-5" />,
        color: "text-green-500",
      },
      gemini: {
        name: "Google Gemini",
        icon: <Activity className="w-5 h-5" />,
        color: "text-blue-500",
      },
    };
    return (
      typeInfo[type] || {
        name: type,
        icon: <Cpu className="w-5 h-5" />,
        color: "text-zinc-500",
      }
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-5rem)] bg-linear-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-black scrollbar-thin">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-linear-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-black scrollbar-thin">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            AIエージェント
          </h1>
          <p className="text-zinc-500 dark:text-zinc-400 mt-1">
            エージェントの管理・実行状況の確認
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          エージェントを追加
        </button>
      </div>

      {/* 利用可能なエージェントタイプ */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
          利用可能なエージェント
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {agentTypes?.registered.map((agentTypeInfo) => {
            const info = getAgentTypeInfo(agentTypeInfo.type);
            const isAvailable = agentTypes.available.includes(agentTypeInfo.type);

            return (
              <div
                key={agentTypeInfo.type}
                className={`p-4 rounded-lg border ${
                  isAvailable
                    ? "bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700"
                    : "bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 opacity-60"
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className={info.color}>{info.icon}</div>
                  <div>
                    <h3 className="font-medium text-zinc-900 dark:text-zinc-100">
                      {agentTypeInfo.name}
                    </h3>
                    {isAvailable ? (
                      <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        利用可能
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-400 flex items-center gap-1">
                        <XCircle className="w-3 h-3" />
                        未設定
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  {agentTypeInfo.description || agentTypeInfo.name}
                </p>
                {agentTypeInfo.capabilities && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {Object.entries(agentTypeInfo.capabilities)
                      .filter(([, v]) => v)
                      .map(([key]) => (
                        <span
                          key={key}
                          className="px-2 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded"
                        >
                          {key === "codeGeneration" && "コード生成"}
                          {key === "codeReview" && "レビュー"}
                          {key === "taskAnalysis" && "分析"}
                          {key === "fileOperations" && "ファイル操作"}
                          {key === "terminalAccess" && "ターミナル"}
                          {key === "gitOperations" && "Git"}
                          {key === "webSearch" && "Web検索"}
                        </span>
                      ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 設定済みエージェント */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
          設定済みエージェント
        </h2>
        {agents.length === 0 ? (
          <div className="text-center py-12 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700">
            <Cpu className="w-12 h-12 mx-auto text-zinc-400 mb-4" />
            <p className="text-zinc-500 dark:text-zinc-400">
              設定されたエージェントがありません
            </p>
            <button
              onClick={() => setShowAddModal(true)}
              className="mt-4 text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              エージェントを追加
            </button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {agents.map((agent) => {
              const info = getAgentTypeInfo(agent.agentType);
              return (
                <div
                  key={agent.id}
                  className="p-4 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div
                        className={`p-2 rounded-lg bg-zinc-100 dark:bg-zinc-700 ${info.color}`}
                      >
                        {info.icon}
                      </div>
                      <div>
                        <h3 className="font-medium text-zinc-900 dark:text-zinc-100">
                          {agent.name}
                        </h3>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">
                          {info.name}
                        </p>
                      </div>
                    </div>
                    {agent.isDefault && (
                      <span className="px-2 py-0.5 text-xs bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 rounded">
                        デフォルト
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-500 dark:text-zinc-400">
                      実行回数: {agent._count?.executions || 0}
                    </span>
                    <Link
                      href={`/agents/${agent.id}/settings`}
                      className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      <Settings className="w-4 h-4" />
                      設定
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 使い方ガイド */}
      <div className="p-6 bg-linear-to-br from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 rounded-lg border border-indigo-200 dark:border-indigo-800">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
          AIエージェントの使い方
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="flex gap-3">
            <div className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 font-medium">
              1
            </div>
            <div>
              <h3 className="font-medium text-zinc-900 dark:text-zinc-100">
                タスクを選択
              </h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                実行したいタスクの詳細ページを開きます
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 font-medium">
              2
            </div>
            <div>
              <h3 className="font-medium text-zinc-900 dark:text-zinc-100">
                開発者モードを有効化
              </h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                タスクのAI駆動開発モードをONにします
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 font-medium">
              3
            </div>
            <div>
              <h3 className="font-medium text-zinc-900 dark:text-zinc-100">
                実行を開始
              </h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                「AIで実行」ボタンをクリックして実行開始
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 追加モーダル */}
      {showAddModal && (
        <AddAgentModal
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false);
            fetchData();
          }}
          agentTypes={agentTypes?.registered || []}
          availableTypes={agentTypes?.available || []}
        />
      )}
      </div>
    </div>
  );
}

function AddAgentModal({
  onClose,
  onSuccess,
  agentTypes,
  availableTypes,
}: {
  onClose: () => void;
  onSuccess: () => void;
  agentTypes: Array<{
    type: string;
    name: string;
    description?: string;
  }>;
  availableTypes: string[];
}) {
  const [name, setName] = useState("");
  const [agentType, setAgentType] = useState("claude-code");
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!availableTypes.includes(agentType)) {
      setError("選択したエージェントタイプは利用できません");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          agentType,
          isDefault,
        }),
      });

      if (res.ok) {
        onSuccess();
      } else {
        const data = await res.json();
        setError(data.error || "エージェントの追加に失敗しました");
      }
    } catch {
      setError("エージェントの追加に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md bg-white dark:bg-zinc-800 rounded-lg shadow-xl">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
            エージェントを追加
          </h2>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  名前
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例: メイン開発エージェント"
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  エージェントタイプ
                </label>
                <select
                  value={agentType}
                  onChange={(e) => setAgentType(e.target.value)}
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  {agentTypes.map((agentTypeOption) => (
                    <option
                      key={agentTypeOption.type}
                      value={agentTypeOption.type}
                      disabled={!availableTypes.includes(agentTypeOption.type)}
                    >
                      {agentTypeOption.name}{" "}
                      {!availableTypes.includes(agentTypeOption.type) && "(利用不可)"}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isDefault"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                  className="w-4 h-4 text-indigo-600 border-zinc-300 rounded focus:ring-indigo-500"
                />
                <label
                  htmlFor="isDefault"
                  className="text-sm text-zinc-700 dark:text-zinc-300"
                >
                  デフォルトエージェントとして設定
                </label>
              </div>
            </div>
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400 mt-4">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {saving ? "追加中..." : "追加"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
