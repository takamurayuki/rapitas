"use client";

import { useEffect, useState } from "react";
import { Bot, AlertCircle, Loader2 } from "lucide-react";
import type { UserSettings } from "@/types";
import { useToast } from "@/components/ui/toast/ToastContainer";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

export default function DeveloperModeSettingsPage() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

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
        showToast("設定を保存しました", "success");
      } else {
        throw new Error("更新に失敗しました");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
      showToast("設定の保存に失敗しました", "error");
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
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
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
    </div>
  );
}
