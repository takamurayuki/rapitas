'use client';
// MemoAnalysisDisplay

import { memo } from 'react';
import { Brain, Eye, EyeOff } from 'lucide-react';
import type { MemoAnalysis } from './types';
import { timeAgo } from './memo-utils';

/**
 * Displays the AI analysis panel with importance, sentiment, keywords, and action items.
 *
 * @param analysis - The analysis result to display / 表示する分析結果
 * @param isVisible - Whether the analysis panel body is expanded / パネル本体が展開されているか
 * @param onToggle - Callback to toggle visibility / 表示切り替えコールバック
 */
export const MemoAnalysisDisplay = memo(function MemoAnalysisDisplay({
  analysis,
  isVisible,
  onToggle,
}: {
  analysis: MemoAnalysis;
  isVisible: boolean;
  onToggle: () => void;
}) {
  const getImportanceColor = (importance: MemoAnalysis['importance']) => {
    switch (importance) {
      case 'high':
        return 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
      case 'medium':
        return 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800';
      case 'low':
        return 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800';
    }
  };

  const getSentimentIcon = (sentiment: MemoAnalysis['sentiment']) => {
    switch (sentiment) {
      case 'positive':
        return <span className="text-emerald-500">😊</span>;
      case 'negative':
        return <span className="text-red-500">😔</span>;
      case 'neutral':
        return <span className="text-zinc-400">😐</span>;
    }
  };

  return (
    <div className="mt-2 space-y-2">
      {/* Toggle Button */}
      <button
        onClick={onToggle}
        className="flex items-center gap-1 px-2 py-0.5 text-[10px] bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-800 rounded-full hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors"
      >
        <Brain className="w-2.5 h-2.5" />
        AI分析結果
        {isVisible ? <EyeOff className="w-2.5 h-2.5" /> : <Eye className="w-2.5 h-2.5" />}
      </button>

      {/* Analysis Results */}
      {isVisible && (
        <div className="p-2.5 bg-purple-50/50 dark:bg-purple-900/10 rounded-lg border border-purple-100 dark:border-purple-800/50 space-y-2">
          {/* Summary */}
          <div>
            <h4 className="text-[10px] font-medium text-purple-700 dark:text-purple-300 mb-1">
              要約
            </h4>
            <p className="text-[10px] text-zinc-600 dark:text-zinc-400">{analysis.summary}</p>
          </div>

          {/* Importance & Sentiment */}
          <div className="flex items-center gap-2">
            <span
              className={`px-1.5 py-0.5 text-[9px] font-medium rounded-full border ${getImportanceColor(
                analysis.importance,
              )}`}
            >
              重要度:{' '}
              {analysis.importance === 'high'
                ? '高'
                : analysis.importance === 'medium'
                  ? '中'
                  : '低'}
            </span>
            <span className="flex items-center gap-1 text-[9px] text-zinc-500 dark:text-zinc-400">
              感情: {getSentimentIcon(analysis.sentiment)}
            </span>
          </div>

          {/* Keywords */}
          {analysis.keywords.length > 0 && (
            <div>
              <h4 className="text-[10px] font-medium text-purple-700 dark:text-purple-300 mb-1">
                キーワード
              </h4>
              <div className="flex flex-wrap gap-1">
                {analysis.keywords.map((keyword, index) => (
                  <span
                    key={index}
                    className="px-1.5 py-0.5 text-[8px] bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded-full"
                  >
                    {keyword}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Action Items */}
          {analysis.actionItems.length > 0 && (
            <div>
              <h4 className="text-[10px] font-medium text-purple-700 dark:text-purple-300 mb-1">
                アクション項目
              </h4>
              <ul className="space-y-0.5">
                {analysis.actionItems.map((item, index) => (
                  <li
                    key={index}
                    className="text-[9px] text-zinc-600 dark:text-zinc-400 flex items-start gap-1"
                  >
                    <span className="text-purple-400 mt-0.5">•</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Analysis timestamp */}
          <div className="text-[8px] text-zinc-400 text-right">
            分析日時: {timeAgo(new Date(analysis.analyzedAt))}
          </div>
        </div>
      )}
    </div>
  );
});
