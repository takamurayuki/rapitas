/**
 * ai-analysis-panel/AnalysisTab.tsx
 *
 * Content panel for the "分析" (Analysis) tab of AIAnalysisPanel.
 * Displays loading state, errors, analysis results with subtask selection, or an empty CTA.
 */

'use client';

import {
  Play,
  Loader2,
  AlertCircle,
  CheckCircle2,
  BrainCircuit,
  Plus,
} from 'lucide-react';
import type { TaskAnalysisResult, DeveloperModeConfig } from '@/types';
import { SkeletonBlock } from '@/components/ui/LoadingSpinner';

type Props = {
  config: DeveloperModeConfig | null;
  isAnalyzing: boolean;
  analysisResult: TaskAnalysisResult | null;
  analysisError: string | null;
  analysisApprovalId: number | null;
  selectedSubtasks: number[];
  onToggleSubtask: (index: number) => void;
  onSelectAll: () => void;
  isCreatingSubtasks: boolean;
  subtaskCreationSuccess: boolean;
  onCreateSubtasks: () => Promise<void>;
  onAnalyze: () => void;
};

/**
 * Renders the analysis tab body including loading skeletons, error states,
 * subtask list with checkboxes, and the initial CTA when no result exists.
 */
export function AnalysisTab({
  config,
  isAnalyzing,
  analysisResult,
  analysisError,
  analysisApprovalId,
  selectedSubtasks,
  onToggleSubtask,
  onSelectAll,
  isCreatingSubtasks,
  subtaskCreationSuccess,
  onCreateSubtasks,
  onAnalyze,
}: Props) {
  if (isAnalyzing) {
    return (
      <div className="p-4 bg-zinc-50 dark:bg-indigo-dark-800/50 rounded-lg space-y-3">
        <div className="flex items-center gap-3">
          <SkeletonBlock className="w-5 h-5 rounded" />
          <SkeletonBlock className="h-4 w-32" />
        </div>
        <div className="space-y-2">
          <SkeletonBlock className="h-4 w-full" />
          <SkeletonBlock className="h-4 w-3/4" />
          <SkeletonBlock className="h-4 w-5/6" />
        </div>
      </div>
    );
  }

  if (analysisError) {
    return (
      <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
        <AlertCircle className="w-5 h-5 text-red-500" />
        <span className="text-sm text-red-600 dark:text-red-400">
          {analysisError}
        </span>
      </div>
    );
  }

  if (analysisResult) {
    const allIndices = analysisResult.suggestedSubtasks?.map((_, i) => i) ?? [];
    const allSelected = selectedSubtasks.length === allIndices.length;

    return (
      <div className="space-y-3">
        <div className="p-3 bg-zinc-50 dark:bg-indigo-dark-800/50 rounded-lg">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            概要
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {analysisResult.summary}
          </p>
        </div>

        {analysisResult.suggestedSubtasks &&
          analysisResult.suggestedSubtasks.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  提案サブタスク ({analysisResult.suggestedSubtasks.length}件)
                </p>
                {analysisApprovalId && !subtaskCreationSuccess && (
                  <button
                    onClick={onSelectAll}
                    className="text-xs text-violet-600 dark:text-violet-400 hover:underline"
                  >
                    {allSelected ? 'すべて解除' : 'すべて選択'}
                  </button>
                )}
              </div>

              <div className="space-y-2 max-h-48 overflow-y-auto">
                {analysisResult.suggestedSubtasks.map((st, i) => (
                  <div
                    key={i}
                    className={`p-2 rounded-lg text-sm flex items-start gap-2 ${
                      analysisApprovalId && !subtaskCreationSuccess
                        ? 'bg-violet-50 dark:bg-violet-900/20 cursor-pointer hover:bg-violet-100 dark:hover:bg-violet-900/30'
                        : 'bg-violet-50 dark:bg-violet-900/20'
                    }`}
                    onClick={() => {
                      if (analysisApprovalId && !subtaskCreationSuccess) {
                        onToggleSubtask(i);
                      }
                    }}
                  >
                    {analysisApprovalId && !subtaskCreationSuccess && (
                      <input
                        type="checkbox"
                        checked={selectedSubtasks.includes(i)}
                        onChange={() => {}}
                        className="mt-0.5 rounded border-violet-300 text-violet-600 focus:ring-violet-500"
                      />
                    )}
                    <div className="flex-1">
                      <span className="font-medium text-violet-700 dark:text-violet-300">
                        {st.title}
                      </span>
                      {st.description && (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                          {st.description.length > 100
                            ? `${st.description.slice(0, 100)}...`
                            : st.description}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <span
                          className={`px-1.5 py-0.5 text-xs rounded ${
                            st.priority === 'high'
                              ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                              : st.priority === 'medium'
                                ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                                : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          }`}
                        >
                          {st.priority === 'high'
                            ? '高'
                            : st.priority === 'medium'
                              ? '中'
                              : '低'}
                        </span>
                        {st.estimatedHours != null && st.estimatedHours > 0 && (
                          <span className="text-xs text-zinc-500">
                            {st.estimatedHours}時間
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {analysisApprovalId && !subtaskCreationSuccess && (
                <div className="mt-3 flex items-center justify-end gap-2">
                  <span className="text-xs text-zinc-500">
                    {selectedSubtasks.length}件選択中
                  </span>
                  <button
                    onClick={onCreateSubtasks}
                    disabled={isCreatingSubtasks}
                    className="flex items-center gap-1 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                  >
                    {isCreatingSubtasks ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Plus className="w-4 h-4" />
                    )}
                    サブタスクを作成
                  </button>
                </div>
              )}

              {subtaskCreationSuccess && (
                <div className="mt-3 flex items-center gap-2 p-2 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  <span className="text-sm text-green-700 dark:text-green-300">
                    サブタスクを作成しました
                  </span>
                </div>
              )}
            </div>
          )}

        <div className="flex justify-end">
          <button
            onClick={onAnalyze}
            disabled={isAnalyzing}
            className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            再分析
          </button>
        </div>
      </div>
    );
  }

  if (!config?.isEnabled) {
    return (
      <div className="text-center py-6">
        <BrainCircuit className="w-10 h-10 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2">
          AIタスク分析を使用するには開発者モードを有効にしてください
        </p>
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          タスク詳細画面の下部にある「開発者モード」トグルをONにしてください
        </p>
      </div>
    );
  }

  return (
    <div className="text-center py-6">
      <BrainCircuit className="w-10 h-10 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
        AIがタスクを分析し、サブタスクを提案します
      </p>
      <button
        onClick={onAnalyze}
        className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-colors"
      >
        <Play className="w-4 h-4" />
        分析を開始
      </button>
    </div>
  );
}
