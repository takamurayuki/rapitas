'use client';

import { useState } from 'react';
import {
  Sparkles,
  Loader2,
  AlertCircle,
  Brain,
  Clock,
  ListChecks,
  Lightbulb,
  Check,
  X,
  Settings,
  BrainCircuit,
} from 'lucide-react';
import type { TaskAnalysisResult, SubtaskProposal, Priority } from '@/types';
import { priorityColors, priorityLabels } from '@/types';
import { SkeletonBlock } from '@/components/ui/LoadingSpinner';

type TaskAnalysisPanelProps = {
  isAnalyzing: boolean;
  analysisResult: TaskAnalysisResult | null;
  error: string | null;
  onAnalyze: () => void;
  onApprove: (selectedSubtasks?: number[]) => void;
  onReject: () => void;
  isApproving?: boolean;
  onOpenSettings?: () => void;
};

export function TaskAnalysisPanel({
  isAnalyzing,
  analysisResult,
  error,
  onAnalyze,
  onApprove,
  onReject,
  isApproving,
  onOpenSettings,
}: TaskAnalysisPanelProps) {
  const [selectedSubtasks, setSelectedSubtasks] = useState<Set<number>>(
    new Set(),
  );
  const [selectAll, setSelectAll] = useState(true);

  const handleToggleSubtask = (index: number) => {
    setSelectedSubtasks((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
    setSelectAll(false);
  };

  const handleToggleAll = () => {
    if (selectAll) {
      setSelectedSubtasks(new Set());
      setSelectAll(false);
    } else {
      setSelectedSubtasks(
        new Set(analysisResult?.suggestedSubtasks.map((_, i) => i) || []),
      );
      setSelectAll(true);
    }
  };

  const handleApprove = () => {
    if (selectAll || selectedSubtasks.size === 0) {
      onApprove();
    } else {
      onApprove(Array.from(selectedSubtasks));
    }
  };

  const complexityColors = {
    simple:
      'text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30',
    medium:
      'text-yellow-600 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-900/30',
    complex: 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/30',
  };

  const complexityLabels = {
    simple: 'シンプル',
    medium: '中程度',
    complex: '複雑',
  };

  // 分析前の状態
  if (!analysisResult && !isAnalyzing && !error) {
    return (
      <div className="bg-linear-to-br from-violet-50 to-indigo-50 dark:from-violet-900/20 dark:to-indigo-900/20 rounded-xl p-6 border border-violet-100 dark:border-violet-800">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-violet-100 dark:bg-violet-900/40 rounded-xl">
            <BrainCircuit className="w-8 h-8 text-violet-600 dark:text-violet-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">
              AI タスク分析
            </h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
              AIがタスクを分析し、効率的なサブタスクを提案
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onAnalyze}
              className="flex items-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-medium transition-colors"
            >
              <Sparkles className="w-4 h-4" />
              分析を開始
            </button>

            {onOpenSettings && (
              <button
                onClick={onOpenSettings}
                className="p-2.5 rounded-lg text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-colors"
                title="AIタスク分析設定"
              >
                <Settings className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 分析中
  if (isAnalyzing) {
    return (
      <div className="bg-zinc-50 dark:bg-indigo-dark-800/50 rounded-xl p-8 border border-zinc-200 dark:border-zinc-700">
        <div className="flex flex-col items-center justify-center gap-4">
          <SkeletonBlock className="w-16 h-16 rounded-full" />
          <div className="text-center space-y-2">
            <SkeletonBlock className="h-5 w-32 mx-auto" />
            <SkeletonBlock className="h-4 w-48 mx-auto" />
          </div>
          <div className="w-full space-y-3 mt-4">
            <SkeletonBlock className="h-4 w-full" />
            <SkeletonBlock className="h-4 w-3/4" />
            <SkeletonBlock className="h-4 w-5/6" />
          </div>
        </div>
      </div>
    );
  }

  // エラー
  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-6 border border-red-200 dark:border-red-800">
        <div className="flex items-center gap-3">
          <AlertCircle className="w-6 h-6 text-red-500" />
          <div className="flex-1">
            <p className="font-medium text-red-700 dark:text-red-300">
              分析に失敗しました
            </p>
            <p className="text-sm text-red-600 dark:text-red-400 mt-1">
              {error}
            </p>
          </div>
          <button
            onClick={onAnalyze}
            className="px-3 py-1.5 text-sm font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors"
          >
            再試行
          </button>
        </div>
      </div>
    );
  }

  // 分析結果
  if (analysisResult) {
    return (
      <div className="bg-white dark:bg-indigo-dark-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
        {/* ヘッダー */}
        <div className="px-6 py-4 bg-linear-to-r from-violet-50 to-indigo-50 dark:from-violet-900/20 dark:to-indigo-900/20 border-b border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-violet-100 dark:bg-violet-900/40 rounded-lg">
                <Sparkles className="w-5 h-5 text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">
                  AI分析結果
                </h3>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {analysisResult.suggestedSubtasks.length}個のサブタスクを提案
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`px-2.5 py-1 rounded-full text-xs font-medium ${complexityColors[analysisResult.complexity]}`}
              >
                {complexityLabels[analysisResult.complexity]}
              </span>
              <div className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-400">
                <Clock className="w-4 h-4" />
                <span>約{analysisResult.estimatedTotalHours}時間</span>
              </div>
              {onOpenSettings && (
                <button
                  onClick={onOpenSettings}
                  className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-colors"
                  title="開発者モード設定"
                >
                  <Settings className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* サマリー */}
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <p className="text-zinc-700 dark:text-zinc-300">
            {analysisResult.summary}
          </p>
        </div>

        {/* サブタスク一覧 */}
        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <ListChecks className="w-5 h-5 text-zinc-400" />
              <span className="font-medium text-zinc-900 dark:text-zinc-50">
                提案されたサブタスク
              </span>
            </div>
            <button
              onClick={handleToggleAll}
              className="text-sm text-violet-600 dark:text-violet-400 hover:underline"
            >
              {selectAll ? '全て解除' : '全て選択'}
            </button>
          </div>

          <div className="space-y-2">
            {analysisResult.suggestedSubtasks.map((subtask, index) => (
              <SubtaskProposalItem
                key={index}
                subtask={subtask}
                index={index}
                isSelected={selectAll || selectedSubtasks.has(index)}
                onToggle={() => handleToggleSubtask(index)}
              />
            ))}
          </div>
        </div>

        {/* 理由・ヒント */}
        {(analysisResult.reasoning || analysisResult.tips?.length) && (
          <div className="px-6 py-4 bg-zinc-50 dark:bg-indigo-dark-800/50 border-t border-zinc-200 dark:border-zinc-800">
            {analysisResult.reasoning && (
              <div className="mb-3">
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  <span className="font-medium">分解理由:</span>{' '}
                  {analysisResult.reasoning}
                </p>
              </div>
            )}
            {analysisResult.tips && analysisResult.tips.length > 0 && (
              <div className="flex items-start gap-2">
                <Lightbulb className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  {analysisResult.tips.map((tip, i) => (
                    <p key={i}>{tip}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* アクションボタン */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-zinc-200 dark:border-zinc-800">
          <button
            onClick={onReject}
            disabled={isApproving}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
          >
            <X className="w-4 h-4" />
            却下
          </button>
          <button
            onClick={handleApprove}
            disabled={
              isApproving || (!selectAll && selectedSubtasks.size === 0)
            }
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {isApproving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            {selectAll ? '全て承認' : `${selectedSubtasks.size}件を承認`}
          </button>
        </div>
      </div>
    );
  }

  return null;
}

function SubtaskProposalItem({
  subtask,
  index,
  isSelected,
  onToggle,
}: {
  subtask: SubtaskProposal;
  index: number;
  isSelected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-start gap-3 p-3 rounded-lg border transition-all text-left ${
        isSelected
          ? 'border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/20'
          : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
      }`}
    >
      <div
        className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
          isSelected
            ? 'border-violet-500 bg-violet-500'
            : 'border-zinc-300 dark:border-zinc-600'
        }`}
      >
        {isSelected && <Check className="w-3 h-3 text-white" />}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs text-zinc-400 dark:text-zinc-500">
            #{index + 1}
          </span>
          <span className="font-medium text-zinc-900 dark:text-zinc-50 truncate">
            {subtask.title}
          </span>
        </div>
        {subtask.description && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400 line-clamp-2">
            {subtask.description}
          </p>
        )}
        <div className="flex items-center gap-3 mt-2">
          <span
            className={`px-2 py-0.5 rounded text-xs font-medium ${priorityColors[subtask.priority as Priority]}`}
          >
            {priorityLabels[subtask.priority as Priority]}
          </span>
          {subtask.estimatedHours && (
            <span className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
              <Clock className="w-3 h-3" />
              {subtask.estimatedHours}h
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
