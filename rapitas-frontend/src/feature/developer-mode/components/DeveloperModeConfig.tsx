"use client";

import { useState, useEffect } from "react";
import {
  X,
  Bot,
  Zap,
  Shield,
  Scale,
  Key,
  Eye,
  EyeOff,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  Save,
  Trash2,
  Loader2,
} from "lucide-react";
import type { DeveloperModeConfig } from "@/types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

type Props = {
  config: DeveloperModeConfig | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updates: Partial<DeveloperModeConfig>) => Promise<DeveloperModeConfig | null>;
};

export function DeveloperModeConfigModal({
  config,
  isOpen,
  onClose,
  onSave,
}: Props) {
  const [autoApprove, setAutoApprove] = useState(config?.autoApprove ?? false);
  const [notifyInApp, setNotifyInApp] = useState(config?.notifyInApp ?? true);
  const [maxSubtasks, setMaxSubtasks] = useState(config?.maxSubtasks ?? 10);
  const [priority, setPriority] = useState<string>(
    config?.priority ?? "balanced"
  );
  const [isSaving, setIsSaving] = useState(false);

  // APIキー関連の状態
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [maskedApiKey, setMaskedApiKey] = useState<string | null>(null);
  const [isApiKeyConfigured, setIsApiKeyConfigured] = useState(false);
  const [isEditingApiKey, setIsEditingApiKey] = useState(false);
  const [isSavingApiKey, setIsSavingApiKey] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [apiKeySuccess, setApiKeySuccess] = useState<string | null>(null);

  // モーダルが開かれた時にAPIキー情報を取得
  useEffect(() => {
    if (isOpen) {
      fetchApiKey();
    }
  }, [isOpen]);

  const fetchApiKey = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/settings/api-key`);
      if (res.ok) {
        const data = await res.json();
        if (data.configured && data.maskedKey) {
          setMaskedApiKey(data.maskedKey);
          setIsApiKeyConfigured(true);
        } else {
          setMaskedApiKey(null);
          setIsApiKeyConfigured(false);
        }
      }
    } catch (err) {
      console.error("APIキー情報の取得に失敗:", err);
    }
  };

  const saveApiKey = async () => {
    if (!apiKeyInput.trim()) return;

    setIsSavingApiKey(true);
    setApiKeyError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/settings/api-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKeyInput }),
      });

      if (res.ok) {
        const data = await res.json();
        setMaskedApiKey(data.maskedKey);
        setApiKeyInput("");
        setIsEditingApiKey(false);
        setShowApiKey(false);
        setIsApiKeyConfigured(true);
        setApiKeySuccess("APIキーを保存しました");
        setTimeout(() => setApiKeySuccess(null), 3000);
      } else {
        throw new Error("保存に失敗しました");
      }
    } catch (err) {
      setApiKeyError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setIsSavingApiKey(false);
    }
  };

  const deleteApiKey = async () => {
    if (!confirm("APIキーを削除してもよろしいですか？")) return;

    setIsSavingApiKey(true);
    setApiKeyError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/settings/api-key`, {
        method: "DELETE",
      });

      if (res.ok) {
        setMaskedApiKey(null);
        setApiKeyInput("");
        setIsEditingApiKey(false);
        setIsApiKeyConfigured(false);
        setApiKeySuccess("APIキーを削除しました");
        setTimeout(() => setApiKeySuccess(null), 3000);
      } else {
        throw new Error("削除に失敗しました");
      }
    } catch (err) {
      setApiKeyError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setIsSavingApiKey(false);
    }
  };

  if (!isOpen) return null;

  const handleSave = async () => {
    setIsSaving(true);
    await onSave({
      autoApprove,
      notifyInApp,
      maxSubtasks,
      priority: priority as DeveloperModeConfig["priority"],
    });
    setIsSaving(false);
    onClose();
  };

  const priorityOptions = [
    {
      value: "conservative",
      label: "慎重",
      icon: Shield,
      description: "少数の大きなサブタスクに分解",
    },
    {
      value: "balanced",
      label: "バランス",
      icon: Scale,
      description: "適度な粒度で分解（推奨）",
    },
    {
      value: "aggressive",
      label: "詳細",
      icon: Zap,
      description: "細かいサブタスクに詳細分解",
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-violet-100 dark:bg-violet-900/30 rounded-lg">
              <Bot className="w-5 h-5 text-violet-600 dark:text-violet-400" />
            </div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              開発者モード設定
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-6 max-h-[60vh] overflow-y-auto">
          {/* APIキー設定 */}
          <div className="p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg space-y-3">
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-violet-500" />
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Claude API キー
              </label>
              {isApiKeyConfigured ? (
                <span className="flex items-center gap-1 px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-xs font-medium">
                  <CheckCircle className="w-3 h-3" />
                  設定済み
                </span>
              ) : (
                <span className="flex items-center gap-1 px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-full text-xs font-medium">
                  <AlertCircle className="w-3 h-3" />
                  未設定
                </span>
              )}
            </div>

            {/* エラー/成功メッセージ */}
            {apiKeyError && (
              <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                <AlertCircle className="w-4 h-4" />
                {apiKeyError}
              </div>
            )}
            {apiKeySuccess && (
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <CheckCircle className="w-4 h-4" />
                {apiKeySuccess}
              </div>
            )}

            {/* APIキーが設定済みの場合 */}
            {isApiKeyConfigured && maskedApiKey && !isEditingApiKey && (
              <div className="flex items-center justify-between gap-2">
                <code className="flex-1 px-2 py-1.5 bg-zinc-200 dark:bg-zinc-700 rounded text-xs font-mono truncate">
                  {maskedApiKey}
                </code>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setIsEditingApiKey(true)}
                    className="px-2 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
                  >
                    変更
                  </button>
                  <button
                    onClick={deleteApiKey}
                    disabled={isSavingApiKey}
                    className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )}

            {/* APIキー入力フォーム（未設定または編集中の場合） */}
            {(!isApiKeyConfigured || isEditingApiKey) && (
              <div className="space-y-2">
                <div className="relative">
                  <input
                    type={showApiKey ? "text" : "password"}
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder="sk-ant-api..."
                    className="w-full px-3 py-2 pr-10 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                  >
                    {showApiKey ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <a
                    href="https://console.anthropic.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 hover:underline"
                  >
                    APIキーを取得
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  <div className="flex items-center gap-2">
                    {isEditingApiKey && (
                      <button
                        onClick={() => {
                          setIsEditingApiKey(false);
                          setApiKeyInput("");
                          setShowApiKey(false);
                        }}
                        className="px-2 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
                      >
                        キャンセル
                      </button>
                    )}
                    <button
                      onClick={saveApiKey}
                      disabled={!apiKeyInput.trim() || isSavingApiKey}
                      className="flex items-center gap-1 px-3 py-1 bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSavingApiKey ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Save className="w-3 h-3" />
                      )}
                      保存
                    </button>
                  </div>
                </div>
              </div>
            )}

            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              AIタスク分析機能を使用するにはAPIキーが必要です
            </p>
          </div>

          {/* 分解レベル */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-3">
              タスク分解レベル
            </label>
            <div className="grid grid-cols-3 gap-2">
              {priorityOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setPriority(option.value)}
                  className={`flex flex-col items-center gap-2 p-3 rounded-lg border transition-all ${
                    priority === option.value
                      ? "border-violet-500 bg-violet-50 dark:bg-violet-900/20"
                      : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600"
                  }`}
                >
                  <option.icon
                    className={`w-5 h-5 ${
                      priority === option.value
                        ? "text-violet-600 dark:text-violet-400"
                        : "text-zinc-400"
                    }`}
                  />
                  <span
                    className={`text-sm font-medium ${
                      priority === option.value
                        ? "text-violet-700 dark:text-violet-300"
                        : "text-zinc-600 dark:text-zinc-400"
                    }`}
                  >
                    {option.label}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              {priorityOptions.find((o) => o.value === priority)?.description}
            </p>
          </div>

          {/* 最大サブタスク数 */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              最大サブタスク数: {maxSubtasks}
            </label>
            <input
              type="range"
              min={3}
              max={15}
              value={maxSubtasks}
              onChange={(e) => setMaxSubtasks(parseInt(e.target.value))}
              className="w-full h-2 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-violet-500"
            />
            <div className="flex justify-between text-xs text-zinc-400 mt-1">
              <span>3</span>
              <span>15</span>
            </div>
          </div>

          {/* 自動承認 */}
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                自動承認
              </label>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                AIの提案を自動的に承認してサブタスクを作成
              </p>
            </div>
            <button
              onClick={() => setAutoApprove(!autoApprove)}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                autoApprove
                  ? "bg-violet-500"
                  : "bg-zinc-300 dark:bg-zinc-600"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  autoApprove ? "translate-x-5" : ""
                }`}
              />
            </button>
          </div>

          {/* アプリ内通知 */}
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                アプリ内通知
              </label>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                承認リクエスト時に通知を表示
              </p>
            </div>
            <button
              onClick={() => setNotifyInApp(!notifyInApp)}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                notifyInApp
                  ? "bg-violet-500"
                  : "bg-zinc-300 dark:bg-zinc-600"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  notifyInApp ? "translate-x-5" : ""
                }`}
              />
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {isSaving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
