/**
 * SubtaskPanel
 *
 * Renders the subtask tab content within the analysis accordion section.
 * Shows loading, error, populated subtask list, or idle call-to-action states.
 * Purely presentational — all async logic is injected via props.
 */

'use client';

import {
  BrainCircuit,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Play,
} from 'lucide-react';
import { SkeletonBlock } from '@/components/ui/LoadingSpinner';
import type { TaskAnalysisResult } from '@/types';

export type SubtaskPanelProps = {
  isAnalyzing: boolean;
  analysisError: string | null;
  analysisResult: TaskAnalysisResult | null;
  analysisApprovalId: number | null;
  selectedSubtasks: number[];
  onSelectSubtask: (index: number) => void;
  onSelectAll: () => void;
  isCreatingSubtasks: boolean;
  subtaskCreationSuccess: boolean;
  onApproveSubtasks: () => Promise<void>;
  onAnalyze: () => Promise<void>;
};

/**
 * Tab panel displaying AI-suggested subtasks with selection and approval controls.
 *
 * @param props.isAnalyzing - Shows a skeleton loader while analysis is in progress.
 * @param props.analysisResult - Populated result; renders the subtask list.
 * @param props.onApproveSubtasks - Called when the user confirms subtask creation.
 */
export function SubtaskPanel({
  isAnalyzing,
  analysisError,
  analysisResult,
  analysisApprovalId,
  selectedSubtasks,
  onSelectSubtask,
  onSelectAll,
  isCreatingSubtasks,
  subtaskCreationSuccess,
  onApproveSubtasks,
  onAnalyze,
}: SubtaskPanelProps) {
  if (isAnalyzing) {
    return (
      <div
        id="subtasks-panel"
        role="tabpanel"
        className="flex items-center gap-2 p-2.5 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg"
      >
        <SkeletonBlock className="w-3.5 h-3.5 rounded" />
        <SkeletonBlock className="h-3 w-24" />
      </div>
    );
  }

  if (analysisError) {
    return (
      <div
        id="subtasks-panel"
        role="tabpanel"
        className="flex items-center gap-2 p-2.5 bg-red-50 dark:bg-red-900/20 rounded-lg"
      >
        <AlertCircle className="w-3.5 h-3.5 text-red-500" />
        <span className="text-xs text-red-600 dark:text-red-400">
          {analysisError}
        </span>
      </div>
    );
  }

  if (analysisResult) {
    const suggestedSubtasks = analysisResult.suggestedSubtasks ?? [];
    const allSelected = selectedSubtasks.length === suggestedSubtasks.length;

    return (
      <div id="subtasks-panel" role="tabpanel" className="space-y-2">
        <div className="p-2 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
          <p className="text-xs text-zinc-700 dark:text-zinc-300 line-clamp-2">
            {analysisResult.summary}
          </p>
        </div>
        {suggestedSubtasks.length > 0 && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                提案サブタスク
              </p>
              {analysisApprovalId && !subtaskCreationSuccess && (
                <button
                  onClick={onSelectAll}
                  className="text-[10px] text-violet-600 dark:text-violet-400 hover:underline"
                >
                  {allSelected ? '解除' : '全選択'}
                </button>
              )}
            </div>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {suggestedSubtasks.map((st, i) => (
                <div
                  key={i}
                  className={`p-1.5 rounded text-xs flex items-start gap-1.5 ${
                    analysisApprovalId && !subtaskCreationSuccess
                      ? 'bg-violet-50 dark:bg-violet-900/20 cursor-pointer hover:bg-violet-100 dark:hover:bg-violet-900/30'
                      : 'bg-violet-50 dark:bg-violet-900/20'
                  }`}
                  onClick={() => {
                    if (analysisApprovalId && !subtaskCreationSuccess) {
                      onSelectSubtask(i);
                    }
                  }}
                >
                  {analysisApprovalId && !subtaskCreationSuccess && (
                    <input
                      type="checkbox"
                      checked={selectedSubtasks.includes(i)}
                      onChange={() => {}}
                      className="mt-0.5 w-3 h-3 rounded border-violet-300 text-violet-600"
                      aria-label={`${st.title}を選択`}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-violet-700 dark:text-violet-300 text-[11px] line-clamp-1">
                      {st.title}
                    </span>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span
                        className={`flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] ${
                          st.priority === 'high'
                            ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                            : st.priority === 'medium'
                              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                              : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                        }`}
                      >
                        {st.priority === 'high' ? (
                          <ChevronUp className="w-2.5 h-2.5" />
                        ) : st.priority === 'medium' ? (
                          <span className="w-2.5 h-2.5 inline-flex items-center justify-center">
                            ↕
                          </span>
                        ) : (
                          <ChevronDown className="w-2.5 h-2.5" />
                        )}
                        {st.priority === 'high'
                          ? '高'
                          : st.priority === 'medium'
                            ? '中'
                            : '低'}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {analysisApprovalId && !subtaskCreationSuccess && (
              <div className="flex items-center justify-end gap-2 pt-1">
                <span className="text-[10px] text-zinc-500">
                  {selectedSubtasks.length}件選択
                </span>
                <button
                  onClick={onApproveSubtasks}
                  disabled={isCreatingSubtasks}
                  className="flex items-center gap-1 px-2 py-1 bg-violet-600 hover:bg-violet-700 text-white text-[10px] font-medium rounded transition-colors disabled:opacity-50"
                >
                  {isCreatingSubtasks ? (
                    <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-2.5 h-2.5" />
                  )}
                  作成
                </button>
              </div>
            )}
            {subtaskCreationSuccess && (
              <div className="flex items-center gap-1.5 p-1.5 bg-green-50 dark:bg-green-900/20 rounded text-[10px] text-green-700 dark:text-green-300">
                <CheckCircle2 className="w-3 h-3" />
                サブタスクを作成しました
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // Idle — show call-to-action
  return (
    <div id="subtasks-panel" role="tabpanel" className="text-center py-4">
      <BrainCircuit className="w-6 h-6 text-zinc-300 dark:text-zinc-600 mx-auto mb-1.5" />
      <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mb-2">
        AIがタスクを分析し、サブタスクを提案します
      </p>
      <button
        onClick={onAnalyze}
        className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-[10px] font-medium rounded-lg transition-colors"
      >
        <Play className="w-3 h-3" />
        分析開始
      </button>
    </div>
  );
}
