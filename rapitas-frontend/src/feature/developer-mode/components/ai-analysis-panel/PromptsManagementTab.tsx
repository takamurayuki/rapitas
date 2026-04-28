'use client';
// ai-analysis-panel/PromptsManagementTab.tsx

import {
  FileText,
  AlertCircle,
  Loader2,
  Target,
  RefreshCw,
  Zap,
  Edit3,
  Copy,
  Trash2,
  Save,
} from 'lucide-react';
import type { PromptsData } from './types';

type Props = {
  promptsData: PromptsData | null;
  isLoadingPrompts: boolean;
  isGeneratingAll: boolean;
  editingPromptId: number | null;
  editingPromptText: string;
  onEditingPromptTextChange: (v: string) => void;
  promptsError: string | null;
  onFetchPrompts: () => Promise<void>;
  onGenerateAll: () => Promise<void>;
  onUpdatePrompt: (promptId: number, newText: string) => Promise<void>;
  onDeletePrompt: (promptId: number) => Promise<void>;
  onStartEditing: (promptId: number, currentText: string) => void;
  onCancelEditing: () => void;
};

/**
 * Renders the full prompt management tab with list, inline editor, and batch controls.
 */
export function PromptsManagementTab({
  promptsData,
  isLoadingPrompts,
  isGeneratingAll,
  editingPromptId,
  editingPromptText,
  onEditingPromptTextChange,
  promptsError,
  onFetchPrompts,
  onGenerateAll,
  onUpdatePrompt,
  onDeletePrompt,
  onStartEditing,
  onCancelEditing,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-zinc-500" />
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            保存済みプロンプト
          </span>
          {promptsData && (
            <span className="px-2 py-0.5 bg-zinc-100 dark:bg-indigo-dark-800 text-zinc-500 text-xs rounded">
              {promptsData.prompts.length}件
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onFetchPrompts}
            disabled={isLoadingPrompts}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 rounded"
            title="更新"
          >
            <RefreshCw className={`w-4 h-4 ${isLoadingPrompts ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onGenerateAll}
            disabled={isGeneratingAll}
            className="flex items-center gap-1 px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded transition-colors disabled:opacity-50"
          >
            {isGeneratingAll ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Zap className="w-3 h-3" />
            )}
            一括生成
          </button>
        </div>
      </div>

      {promptsError && (
        <div className="flex items-center gap-2 p-2 bg-red-50 dark:bg-red-900/20 rounded text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="w-4 h-4" />
          {promptsError}
        </div>
      )}

      {isLoadingPrompts ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 text-zinc-400 animate-spin" />
        </div>
      ) : promptsData ? (
        <div className="space-y-3">
          <div className="p-2 bg-zinc-50 dark:bg-indigo-dark-800/50 rounded-lg text-xs">
            <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
              <Target className="w-3 h-3" />
              <span className="font-medium">{promptsData.task.title}</span>
              {promptsData.task.hasSubtasks && promptsData.subtasks && (
                <span className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded">
                  サブタスク: {promptsData.subtasks.length}件
                </span>
              )}
            </div>
          </div>

          {promptsData.prompts.length === 0 ? (
            <div className="text-center py-6">
              <FileText className="w-10 h-10 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2">
                保存されたプロンプトはありません
              </p>
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                「一括生成」または「最適化」タブでプロンプトを生成してください
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {promptsData.prompts.map((prompt) => {
                const isEditing = editingPromptId === prompt.id;
                const subtask = promptsData.subtasks?.find((st) => st.id === prompt.taskId);
                const isParentTask = prompt.taskId === promptsData.task.id;

                return (
                  <div
                    key={prompt.id}
                    className="p-3 bg-zinc-50 dark:bg-indigo-dark-800/50 rounded-lg"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                            {isParentTask ? promptsData.task.title : (subtask?.title ?? '不明')}
                          </span>
                          {isParentTask ? (
                            <span className="px-1.5 py-0.5 bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 text-xs rounded">
                              親タスク
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs rounded">
                              サブタスク
                            </span>
                          )}
                          {prompt.qualityScore != null && (
                            <span
                              className={`text-xs ${
                                prompt.qualityScore >= 80
                                  ? 'text-green-600'
                                  : prompt.qualityScore >= 60
                                    ? 'text-yellow-600'
                                    : 'text-red-600'
                              }`}
                            >
                              スコア: {prompt.qualityScore}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {isEditing ? (
                          <>
                            <button
                              onClick={() => onUpdatePrompt(prompt.id, editingPromptText)}
                              className="p-1 text-green-500 hover:text-green-600"
                            >
                              <Save className="w-3 h-3" />
                            </button>
                            <button
                              onClick={onCancelEditing}
                              className="p-1 text-zinc-400 hover:text-zinc-600"
                            >
                              ×
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => onStartEditing(prompt.id, prompt.optimizedPrompt)}
                              className="p-1 text-zinc-400 hover:text-zinc-600"
                              title="編集"
                            >
                              <Edit3 className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => navigator.clipboard.writeText(prompt.optimizedPrompt)}
                              className="p-1 text-zinc-400 hover:text-zinc-600"
                              title="コピー"
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => onDeletePrompt(prompt.id)}
                              className="p-1 text-red-400 hover:text-red-600"
                              title="削除"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {isEditing ? (
                      <textarea
                        value={editingPromptText}
                        onChange={(e) => onEditingPromptTextChange(e.target.value)}
                        className="w-full p-2 bg-white dark:bg-indigo-dark-900 border border-zinc-200 dark:border-zinc-700 rounded text-xs font-mono resize-none"
                        rows={4}
                      />
                    ) : (
                      <div className="text-xs text-zinc-600 dark:text-zinc-400 font-mono bg-white dark:bg-indigo-dark-900 p-2 rounded max-h-20 overflow-y-auto whitespace-pre-wrap">
                        {prompt.optimizedPrompt.length > 200
                          ? `${prompt.optimizedPrompt.slice(0, 200)}...`
                          : prompt.optimizedPrompt}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-6">
          <FileText className="w-10 h-10 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            プロンプト情報を読み込んでいます...
          </p>
        </div>
      )}
    </div>
  );
}
