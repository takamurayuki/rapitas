'use client';

/**
 * execution-log-viewer/LiveStatsBar.tsx
 *
 * Thin status strip rendered above the log body during active execution
 * in simple view mode.  Shows live file-change, test, commit, and error
 * counts derived from the execution summary.
 */

import React from 'react';
import { FileEdit, TestTube, CheckCircle2, AlertCircle } from 'lucide-react';
import type { ExecutionSummary } from '../../utils/log-message-transformer';

type LiveStatsBarProps = {
  summary: ExecutionSummary;
};

/**
 * Renders the live execution stats bar for simple view mode.
 *
 * Only mount this component when execution is actively running; the parent
 * is responsible for the visibility gate.
 *
 * @param summary - Current aggregated execution metrics. / 現在集計中の実行メトリクス。
 */
export const LiveStatsBar: React.FC<LiveStatsBarProps> = ({ summary }) => {
  const totalFiles =
    summary.filesEdited.length + summary.filesCreated.length;

  return (
    <div className="flex items-center gap-4 px-4 py-1.5 bg-zinc-800/60 border-b border-zinc-700/50 text-xs text-zinc-400">
      {totalFiles > 0 && (
        <span className="flex items-center gap-1">
          <FileEdit className="w-3 h-3" />
          {totalFiles}ファイル
        </span>
      )}
      {summary.testsRun > 0 && (
        <span className="flex items-center gap-1">
          <TestTube className="w-3 h-3" />
          {summary.testsPassed > 0 && (
            <span className="text-green-400">{summary.testsPassed}成功</span>
          )}
          {summary.testsFailed > 0 && (
            <span className="text-red-400">{summary.testsFailed}失敗</span>
          )}
        </span>
      )}
      {summary.commits > 0 && (
        <span className="flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" />
          {summary.commits}コミット
        </span>
      )}
      {summary.errors.length > 0 && (
        <span className="flex items-center gap-1 text-red-400">
          <AlertCircle className="w-3 h-3" />
          {summary.errors.length}エラー
        </span>
      )}
    </div>
  );
};
