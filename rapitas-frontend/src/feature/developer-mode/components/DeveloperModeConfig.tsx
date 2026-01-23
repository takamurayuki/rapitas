"use client";

import { useState } from "react";
import { X, Bot, Zap, Shield, Scale } from "lucide-react";
import type { DeveloperModeConfig } from "@/types";

type Props = {
  config: DeveloperModeConfig | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updates: Partial<DeveloperModeConfig>) => Promise<any>;
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
        <div className="px-6 py-4 space-y-6">
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
