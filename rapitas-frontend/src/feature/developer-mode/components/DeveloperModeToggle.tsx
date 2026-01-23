"use client";

import { Bot, Settings } from "lucide-react";

type Props = {
  isEnabled: boolean;
  isLoading: boolean;
  onToggle: () => void;
  onOpenSettings?: () => void;
};

export function DeveloperModeToggle({
  isEnabled,
  isLoading,
  onToggle,
  onOpenSettings,
}: Props) {
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onToggle}
        disabled={isLoading}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
          isEnabled
            ? "bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-700"
            : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-700"
        }`}
      >
        <Bot
          className={`w-4 h-4 ${isEnabled ? "text-violet-600 dark:text-violet-400" : ""}`}
        />
        <span>開発者モード</span>
        <span
          className={`px-1.5 py-0.5 rounded text-xs ${
            isEnabled
              ? "bg-violet-200 dark:bg-violet-800 text-violet-700 dark:text-violet-200"
              : "bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400"
          }`}
        >
          {isEnabled ? "ON" : "OFF"}
        </span>
      </button>

      {isEnabled && onOpenSettings && (
        <button
          onClick={onOpenSettings}
          className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          title="開発者モード設定"
        >
          <Settings className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
