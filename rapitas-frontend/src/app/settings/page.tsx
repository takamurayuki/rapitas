"use client";

import { useEffect, useState } from "react";
import {
  Key,
  CheckCircle,
  AlertCircle,
  Loader2,
  ExternalLink,
  Eye,
  EyeOff,
  Trash2,
  Save,
} from "lucide-react";
import type { UserSettings } from "@/types";
import { API_BASE_URL } from "@/utils/api";

export default function SettingsPage() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // APIキー設定用の状態
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [maskedApiKey, setMaskedApiKey] = useState<string | null>(null);
  const [isEditingApiKey, setIsEditingApiKey] = useState(false);
  const [isSavingApiKey, setIsSavingApiKey] = useState(false);

  useEffect(() => {
    fetchSettings();
    fetchApiKey();
  }, []);

  const fetchSettings = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/settings`);
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
      }
    } catch {
      setError("設定の取得に失敗しました");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchApiKey = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/settings/api-key`);
      if (res.ok) {
        const data = await res.json();
        if (data.configured && data.maskedKey) {
          setMaskedApiKey(data.maskedKey);
        } else {
          setMaskedApiKey(null);
        }
      }
    } catch (err) {
      console.error("APIキー情報の取得に失敗:", err);
    }
  };

  const saveApiKey = async () => {
    if (!apiKeyInput.trim()) return;

    setIsSavingApiKey(true);
    setError(null);
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
        setSettings((prev) =>
          prev ? { ...prev, claudeApiKeyConfigured: true } : prev,
        );
        setSuccessMessage("APIキーを保存しました");
        setTimeout(() => setSuccessMessage(null), 3000);
      } else {
        throw new Error("保存に失敗しました");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setIsSavingApiKey(false);
    }
  };

  const deleteApiKey = async () => {
    if (!confirm("APIキーを削除してもよろしいですか？")) return;

    setIsSavingApiKey(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/settings/api-key`, {
        method: "DELETE",
      });

      if (res.ok) {
        setMaskedApiKey(null);
        setApiKeyInput("");
        setIsEditingApiKey(false);
        setSettings((prev) =>
          prev ? { ...prev, claudeApiKeyConfigured: false } : prev,
        );
        setSuccessMessage("APIキーを削除しました");
        setTimeout(() => setSuccessMessage(null), 3000);
      } else {
        throw new Error("削除に失敗しました");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setIsSavingApiKey(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="p-2.5 bg-violet-100 dark:bg-violet-900/30 rounded-xl">
          <Key className="w-6 h-6 text-violet-600 dark:text-violet-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            APIキー設定
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            AI機能に必要なAPIキーを管理
          </p>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertCircle className="w-5 h-5" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {successMessage && (
        <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
            <CheckCircle className="w-5 h-5" />
            <span>{successMessage}</span>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {/* API設定 */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-3">
              <Key className="w-5 h-5 text-zinc-400" />
              <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
                API設定
              </h2>
            </div>
          </div>
          <div className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-medium text-zinc-900 dark:text-zinc-50">
                  Claude API キー
                </h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                  開発者モードのAI分析機能に必要です
                </p>
              </div>
              <div className="flex items-center gap-2">
                {settings?.claudeApiKeyConfigured ? (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-sm font-medium">
                    <CheckCircle className="w-4 h-4" />
                    設定済み
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-full text-sm font-medium">
                    <AlertCircle className="w-4 h-4" />
                    未設定
                  </span>
                )}
              </div>
            </div>

            {/* APIキーが設定済みの場合 */}
            {settings?.claudeApiKeyConfigured &&
              maskedApiKey &&
              !isEditingApiKey && (
                <div className="mt-4 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-1">
                        現在のAPIキー
                      </p>
                      <code className="block px-2 py-1 bg-zinc-200 dark:bg-zinc-700 rounded text-sm font-mono truncate">
                        {maskedApiKey}
                      </code>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => setIsEditingApiKey(true)}
                        className="px-3 py-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
                      >
                        変更
                      </button>
                      <button
                        onClick={deleteApiKey}
                        disabled={isSavingApiKey}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors disabled:opacity-50"
                      >
                        <Trash2 className="w-4 h-4" />
                        削除
                      </button>
                    </div>
                  </div>
                </div>
              )}

            {/* APIキー入力フォーム（未設定または編集中の場合） */}
            {(!settings?.claudeApiKeyConfigured || isEditingApiKey) && (
              <div className="mt-4 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg space-y-4">
                <div>
                  <label
                    htmlFor="apiKey"
                    className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2"
                  >
                    APIキー
                  </label>
                  <div className="relative">
                    <input
                      type={showApiKey ? "text" : "password"}
                      id="apiKey"
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder="sk-ant-api..."
                      className="w-full px-4 py-2.5 pr-12 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                    >
                      {showApiKey ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <a
                    href="https://console.anthropic.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm text-violet-600 dark:text-violet-400 hover:underline"
                  >
                    Anthropic Console でAPIキーを取得
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <div className="flex items-center gap-2">
                    {isEditingApiKey && (
                      <button
                        onClick={() => {
                          setIsEditingApiKey(false);
                          setApiKeyInput("");
                          setShowApiKey(false);
                        }}
                        className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
                      >
                        キャンセル
                      </button>
                    )}
                    <button
                      onClick={saveApiKey}
                      disabled={!apiKeyInput.trim() || isSavingApiKey}
                      className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSavingApiKey ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Save className="w-4 h-4" />
                      )}
                      保存
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
