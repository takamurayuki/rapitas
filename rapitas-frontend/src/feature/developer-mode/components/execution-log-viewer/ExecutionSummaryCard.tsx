'use client';

/**
 * execution-log-viewer/ExecutionSummaryCard.tsx
 *
 * Completion summary card rendered at the bottom of the simple-mode log view.
 * Shows counts of changed files, test results, commits, duration, and errors.
 * Uses icons only — no emoji.
 */

import React from 'react';
import {
  CheckCircle2,
  AlertCircle,
  Square,
  FileEdit,
  TestTube,
} from 'lucide-react';
import type { ExecutionSummary } from '../../utils/log-message-transformer';
import type { ExecutionLogStatus } from './types';

type ExecutionSummaryCardProps = {
  summary: ExecutionSummary;
  status: ExecutionLogStatus;
};

/**
 * Displays a compact post-execution summary card.
 *
 * @param summary - Aggregated metrics derived from the log stream. / ログストリームから集計したメトリクス。
 * @param status - Final execution status, used to choose success / failure theming. / 成功／失敗テーマの選択に使う最終ステータス。
 */
export const ExecutionSummaryCard: React.FC<ExecutionSummaryCardProps> = ({
  summary,
  status,
}) => {
  const isSuccess = status === 'completed';
  const totalFiles = summary.filesEdited.length + summary.filesCreated.length;

  return (
    <div
      className={`mt-4 rounded-lg border p-4 ${
        isSuccess
          ? 'border-green-500/40 bg-green-950/20'
          : 'border-red-500/40 bg-red-950/20'
      }`}
      style={{ animation: 'fadeInSlide 0.3s ease-out' }}
    >
      <div
        className={`flex items-center gap-2 text-sm font-semibold mb-3 ${
          isSuccess ? 'text-green-300' : 'text-red-300'
        }`}
      >
        {isSuccess ? (
          <CheckCircle2 className="w-4 h-4" />
        ) : (
          <AlertCircle className="w-4 h-4" />
        )}
        {isSuccess ? '完了しました' : '実行に失敗しました'}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
        {totalFiles > 0 && (
          <div className="flex items-center gap-2 text-zinc-300">
            <FileEdit className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-zinc-500">変更:</span>
            <span className="font-medium">{totalFiles}件</span>
          </div>
        )}
        {summary.testsRun > 0 && (
          <div className="flex items-center gap-2 text-zinc-300">
            <TestTube className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-zinc-500">テスト:</span>
            <span className="font-medium">
              {summary.testsPassed > 0 && (
                <span className="text-green-400">
                  {summary.testsPassed}成功
                </span>
              )}
              {summary.testsFailed > 0 && (
                <span className="text-red-400 ml-1">
                  {summary.testsFailed}失敗
                </span>
              )}
            </span>
          </div>
        )}
        {summary.commits > 0 && (
          <div className="flex items-center gap-2 text-zinc-300">
            <CheckCircle2 className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-zinc-500">コミット:</span>
            <span className="font-medium">{summary.commits}件</span>
          </div>
        )}
        {summary.durationSeconds !== undefined && (
          <div className="flex items-center gap-2 text-zinc-300">
            <Square className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-zinc-500">所要時間:</span>
            <span className="font-medium">
              {summary.durationSeconds >= 60
                ? `${Math.floor(summary.durationSeconds / 60)}分${Math.round(summary.durationSeconds % 60)}秒`
                : `${Math.round(summary.durationSeconds)}秒`}
            </span>
          </div>
        )}
        <div className="col-span-2 flex items-center gap-2 text-zinc-300">
          <span className="text-zinc-500">課題:</span>
          <span className="font-medium">
            {summary.errors.length > 0
              ? summary.errors.map((e, i) => (
                  <span key={i} className="text-red-400">
                    {e}
                    {i < summary.errors.length - 1 ? ', ' : ''}
                  </span>
                ))
              : 'なし'}
          </span>
        </div>
      </div>
      {(summary.filesEdited.length > 0 || summary.filesCreated.length > 0) && (
        <details className="mt-3">
          <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-400">
            変更ファイル一覧
          </summary>
          <div className="mt-2 text-xs text-zinc-400 font-mono space-y-0.5 pl-2 border-l border-zinc-700">
            {summary.filesCreated.map((f) => (
              <div key={f} className="text-green-400">
                + {f}
              </div>
            ))}
            {summary.filesEdited.map((f) => (
              <div key={f} className="text-amber-400">
                ~ {f}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
};
