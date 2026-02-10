"use client";

import { useEffect, useState } from "react";
import { Bot, AlertCircle, Loader2, RotateCcw, Zap, Sparkles } from "lucide-react";
import type { UserSettings } from "@/types";
import { useToast } from "@/components/ui/toast/ToastContainer";
import { API_BASE_URL } from "@/utils/api";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";

export default function DeveloperModeSettingsPage() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  // 自動再開設定
  const [isSavingAutoResume, setIsSavingAutoResume] = useState(false);
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
    } catch {
      setError("設定の取得に失敗しました");
    } finally {
      setIsLoading(false);
    }
  };

  const updateSettings = async (updates: Partial<UserSettings>) => {
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const data = await res.json();
        setSettings((prev) => (prev ? { ...prev, ...data } : data));
      } else {
        const errorData = await res.json().catch(() => null);
        const errorMsg = errorData?.message || errorData?.error || "更新に失敗しました";
        throw new Error(errorMsg);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
      showToast(err instanceof Error ? err.message : "設定の保存に失敗しました", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const toggleAutoResume = async () => {
    if (!settings) return;
    const newValue = !settings.autoResumeInterruptedTasks;
    setIsSavingAutoResume(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoResumeInterruptedTasks: newValue }),
      });
      if (res.ok) {
        setSettings((prev) =>
          prev ? { ...prev, autoResumeInterruptedTasks: newValue } : prev,
        );
      } else {
        const errorData = await res.json().catch(() => null);
        const errorMsg = errorData?.message || errorData?.error || "設定の保存に失敗しました";
        setError(errorMsg);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "設定の保存に失敗しました");
    } finally {
      setIsSavingAutoResume(false);
    }
  };

  if (isLoading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="p-2.5 bg-violet-100 dark:bg-violet-900/30 rounded-xl">
          <Bot className="w-6 h-6 text-violet-600 dark:text-violet-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            タスクの設定
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            AIによるタスク分析と自動サブタスク提案
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

      <div className="space-y-6">
        {/* AIアシスタント設定 */}
        <div className="bg-white dark:bg-indigo-dark-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-3">
              <Bot className="w-5 h-5 text-violet-500" />
              <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
                AIアシスタント設定
              </h2>
            </div>
          </div>
          <div className="p-6 space-y-6">
            {/* AIアシスタント有効設定 */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-zinc-900 dark:text-zinc-50">
                  AIアシスタントを有効にする
                </h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                  開発プロジェクトのタスク詳細画面でAIアシスタントパネルを表示します
                </p>
              </div>
              <button
                onClick={() =>
                  updateSettings({
                    aiTaskAnalysisDefault: !settings?.aiTaskAnalysisDefault,
                  })
                }
                disabled={isSaving}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  settings?.aiTaskAnalysisDefault
                    ? "bg-violet-500"
                    : "bg-zinc-300 dark:bg-zinc-600"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    settings?.aiTaskAnalysisDefault ? "translate-x-5" : ""
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* タスク作成時の設定 */}
      <div className="bg-white dark:bg-indigo-dark-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden mt-8">
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <Zap className="w-5 h-5 text-violet-500" />
            <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
              タスク作成時の設定
            </h2>
          </div>
        </div>
        <div className="p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-zinc-900 dark:text-zinc-50">
                作成後にすぐ実行
              </h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                タスク作成後、自動的にAIエージェントによる実行を開始します
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  updateSettings({
                    autoExecuteAfterCreate: !settings?.autoExecuteAfterCreate,
                  })
                }
                disabled={isSaving}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                  settings?.autoExecuteAfterCreate
                    ? "bg-violet-500"
                    : "bg-zinc-300 dark:bg-zinc-600"
                }`}
                role="switch"
                aria-checked={settings?.autoExecuteAfterCreate ?? false}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                    settings?.autoExecuteAfterCreate
                      ? "translate-x-5"
                      : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-zinc-900 dark:text-zinc-50">
                タイトルの自動生成
              </h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                説明を入力すると、AIが自動的にタスクのタイトルを生成します
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  updateSettings({
                    autoGenerateTitle: !settings?.autoGenerateTitle,
                  })
                }
                disabled={isSaving}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                  settings?.autoGenerateTitle
                    ? "bg-violet-500"
                    : "bg-zinc-300 dark:bg-zinc-600"
                }`}
                role="switch"
                aria-checked={settings?.autoGenerateTitle ?? false}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                    settings?.autoGenerateTitle
                      ? "translate-x-5"
                      : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* タスク自動再開設定 */}
      <div className="bg-white dark:bg-indigo-dark-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden mt-8">
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <RotateCcw className="w-5 h-5 text-violet-500" />
            <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
              タスク自動再開設定
            </h2>
          </div>
        </div>
        <div className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-zinc-900 dark:text-zinc-50">
                中断タスク自動再開
              </h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                アプリ起動時に中断されたAIエージェントのタスクを自動再開します
              </p>
            </div>
            <div className="flex items-center gap-2">
              {isSavingAutoResume && (
                <Loader2 className="w-4 h-4 text-violet-500 animate-spin" />
              )}
              <button
                onClick={toggleAutoResume}
                disabled={isSavingAutoResume}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                  settings?.autoResumeInterruptedTasks
                    ? "bg-violet-600"
                    : "bg-zinc-300 dark:bg-zinc-600"
                }`}
                role="switch"
                aria-checked={settings?.autoResumeInterruptedTasks ?? false}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                    settings?.autoResumeInterruptedTasks
                      ? "translate-x-5"
                      : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
