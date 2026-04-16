'use client';
// ImplementationSummarySection

import { useState } from 'react';
import { FileText, Code2, Timer } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

type ImplementationSummarySectionProps = {
  summary: string;
  executionTimeMs?: number;
  filesCount: number;
};

// Characters before truncating long summaries
const COLLAPSE_THRESHOLD = 300;

/**
 * Renders the implementation summary with optional expand/collapse for long text.
 *
 * @param summary - Markdown-formatted implementation description / 実装内容の説明（Markdown形式）
 * @param executionTimeMs - Total execution time in milliseconds / 実行時間（ミリ秒）
 * @param filesCount - Number of changed files / 変更ファイル数
 */
export function ImplementationSummarySection({
  summary,
  executionTimeMs,
  filesCount,
}: ImplementationSummarySectionProps) {
  const isLong = summary.length > COLLAPSE_THRESHOLD;
  const [isExpanded, setIsExpanded] = useState(!isLong);

  const displaySummary = isExpanded
    ? summary
    : summary.substring(0, COLLAPSE_THRESHOLD).replace(/\s+\S*$/, '') + '...';

  return (
    <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
      <div className="flex items-start gap-3">
        <div className="p-2 bg-violet-100 dark:bg-violet-900/30 rounded-lg shrink-0">
          <FileText className="w-4 h-4 text-violet-600 dark:text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              実装内容の説明
            </h4>
            <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
              {filesCount > 0 && (
                <span className="flex items-center gap-1">
                  <Code2 className="w-3.5 h-3.5" />
                  {filesCount}ファイル変更
                </span>
              )}
              {executionTimeMs && (
                <span className="flex items-center gap-1">
                  <Timer className="w-3.5 h-3.5" />
                  {Math.round(executionTimeMs / 1000)}秒
                </span>
              )}
            </div>
          </div>
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown>{displaySummary}</ReactMarkdown>
          </div>
          {isLong && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="mt-2 text-xs font-medium text-violet-600 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300 transition-colors"
            >
              {isExpanded ? '折りたたむ' : 'すべて表示'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
