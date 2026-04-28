'use client';
// PanelHeader

import { Bot, Sparkles, CheckCircle2, Settings } from 'lucide-react';
import type { TaskAnalysisResult } from '@/types';

type PanelHeaderProps = {
  /** Whether an optimized prompt has been generated and applied. */
  optimizedPrompt?: string | null;
  /** Non-null when a task analysis has been completed. */
  analysisResult: TaskAnalysisResult | null;
  /** Opens the AI settings modal. */
  onOpenSettings: () => void;
};

/**
 * Top header for the AI accordion panel.
 * Shows the panel title, context badges, and access to detailed settings.
 *
 * @param props.optimizedPrompt - When set, renders the "最適化" badge.
 * @param props.analysisResult - When set, renders the "分析完了" badge.
 * @param props.onOpenSettings - Callback invoked by the settings gear button.
 */
export function PanelHeader({ optimizedPrompt, analysisResult, onOpenSettings }: PanelHeaderProps) {
  return (
    <div className="px-4 py-3 bg-linear-to-r from-violet-50 via-indigo-50 to-purple-50 dark:from-violet-950/30 dark:via-indigo-950/30 dark:to-purple-950/30 border-b border-zinc-200 dark:border-zinc-700">
      <div className="flex items-center gap-2">
        <div className="p-1.5 bg-violet-100 dark:bg-violet-900/40 rounded-lg">
          <Bot className="w-4 h-4 text-violet-600 dark:text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-sm text-zinc-900 dark:text-zinc-50">AI アシスタント</h2>
          <p className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate">
            分析・最適化・自動実装
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          {optimizedPrompt && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-[10px] font-medium">
              <Sparkles className="w-2.5 h-2.5" />
              <span className="hidden sm:inline">最適化</span>
            </span>
          )}
          {analysisResult && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 rounded-full text-[10px] font-medium">
              <CheckCircle2 className="w-2.5 h-2.5" />
              <span className="hidden sm:inline">分析完了</span>
            </span>
          )}
          <button
            onClick={onOpenSettings}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
            aria-label="AI設定を開く"
            title="詳細設定"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
