"use client";

import { useEffect, useState } from "react";
import {
  Settings,
  Bot,
  Key,
  CheckCircle,
  AlertCircle,
  Loader2,
  ExternalLink,
} from "lucide-react";
import type { UserSettings } from "@/types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

export default function SettingsPage() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/settings`);
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
      }
    } catch (err) {
      setError("設定の取得に失敗しました");
    } finally {
      setIsLoading(false);
    }
  };

  const updateSettings = async (updates: Partial<UserSettings>) => {
    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const res = await fetch(`${API_BASE_URL}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const data = await res.json();
        setSettings((prev) => (prev ? { ...prev, ...data } : data));
        setSuccessMessage("設定を保存しました");
        setTimeout(() => setSuccessMessage(null), 3000);
      } else {
        throw new Error("更新に失敗しました");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSaving(false);
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
        <div className="p-2.5 bg-zinc-100 dark:bg-zinc-800 rounded-xl">
          <Settings className="w-6 h-6 text-zinc-600 dark:text-zinc-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            設定
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            アプリケーションの設定を管理
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

            {!settings?.claudeApiKeyConfigured && (
              <div className="mt-4 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-3">
                  APIキーはサーバーの環境変数
                  <code className="mx-1 px-1.5 py-0.5 bg-zinc-200 dark:bg-zinc-700 rounded text-xs">
                    CLAUDE_API_KEY
                  </code>
                  で設定してください。
                </p>
                <a
                  href="https://console.anthropic.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-violet-600 dark:text-violet-400 hover:underline"
                >
                  Anthropic Console でAPIキーを取得
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            )}
          </div>
        </div>

        {/* 開発者モード設定 */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-3">
              <Bot className="w-5 h-5 text-violet-500" />
              <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
                開発者モード
              </h2>
            </div>
          </div>
          <div className="p-6 space-y-6">
            {/* デフォルト設定 */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-zinc-900 dark:text-zinc-50">
                  新規タスクで開発者モードをデフォルト有効
                </h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                  新しく作成するタスクで自動的に開発者モードを有効にします
                </p>
              </div>
              <button
                onClick={() =>
                  updateSettings({
                    developerModeDefault: !settings?.developerModeDefault,
                  })
                }
                disabled={isSaving}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  settings?.developerModeDefault
                    ? "bg-violet-500"
                    : "bg-zinc-300 dark:bg-zinc-600"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    settings?.developerModeDefault ? "translate-x-5" : ""
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* 情報 */}
        <div className="bg-gradient-to-br from-violet-50 to-indigo-50 dark:from-violet-900/20 dark:to-indigo-900/20 rounded-xl p-6 border border-violet-100 dark:border-violet-800">
          <div className="flex items-start gap-4">
            <div className="p-2 bg-violet-100 dark:bg-violet-900/40 rounded-lg">
              <Bot className="w-6 h-6 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <h3 className="font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
                開発者モードについて
              </h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-3">
                開発者モードを有効にすると、AIがタスクを分析し、効率的なサブタスクを自動的に提案します。
                提案されたサブタスクは承認後に作成されます。
              </p>
              <ul className="text-sm text-zinc-600 dark:text-zinc-400 space-y-1">
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  タスクの自動分析・サブタスク提案
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  承認フローによる安全な運用
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  アプリ内通知でリアルタイム確認
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
