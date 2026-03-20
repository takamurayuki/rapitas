/**
 * ExecutionReviewPanel
 *
 * Top-level review panel displayed after agent execution completes.
 * Composes ImplementationSummarySection, ScreenshotsSection, FeedbackSection,
 * CommitApprovalSection, and DiffViewer into a single cohesive review UI.
 */

'use client';

import { useState } from 'react';
import { Terminal, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { DiffViewer } from './DiffViewer';
import { ImplementationSummarySection } from './execution-review/ImplementationSummarySection';
import { ScreenshotsSection } from './execution-review/ScreenshotsSection';
import { FeedbackSection } from './execution-review/FeedbackSection';
import { CommitApprovalSection } from './execution-review/CommitApprovalSection';
import type {
  FileDiff,
  AgentExecution,
  ReviewComment,
  ScreenshotInfo,
} from '@/types';

type ExecutionReviewPanelProps = {
  execution?: AgentExecution;
  files: FileDiff[];
  executionLog?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  onApprove: (commitMessage: string, baseBranch: string) => Promise<void>;
  onReject: () => Promise<void>;
  onRequestChanges?: (
    feedback: string,
    comments: ReviewComment[],
  ) => Promise<void>;
  isProcessing?: boolean;
  error?: string | null;
  defaultBranch?: string;
  implementationSummary?: string;
  executionTimeMs?: number;
  taskId?: number;
  screenshots?: ScreenshotInfo[];
  workingDirectory?: string;
};

export function ExecutionReviewPanel({
  execution,
  files,
  executionLog,
  status,
  onApprove,
  onReject,
  onRequestChanges,
  isProcessing = false,
  error,
  defaultBranch = 'main',
  implementationSummary,
  executionTimeMs,
  taskId,
  screenshots: initialScreenshots,
  workingDirectory,
}: ExecutionReviewPanelProps) {
  const [showLog, setShowLog] = useState(false);

  // True when the commit form and approve button should be available
  const isReadyToApprove = status === 'completed' && files.length > 0;

  return (
    <div className="bg-white dark:bg-indigo-dark-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      {/* Error Message */}
      {error && (
        <div className="px-6 py-4 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        </div>
      )}

      {/* Implementation Summary */}
      {implementationSummary && (
        <ImplementationSummarySection
          summary={implementationSummary}
          executionTimeMs={executionTimeMs}
          filesCount={files.length}
        />
      )}

      {/* Execution Log */}
      {executionLog && (
        <div className="border-b border-zinc-200 dark:border-zinc-800">
          <button
            onClick={() => setShowLog(!showLog)}
            className="w-full flex items-center gap-3 px-6 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors"
          >
            {showLog ? (
              <ChevronDown className="w-4 h-4 text-zinc-400" />
            ) : (
              <ChevronRight className="w-4 h-4 text-zinc-400" />
            )}
            <Terminal className="w-4 h-4 text-zinc-400" />
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              実行ログ
            </span>
          </button>
          {showLog && (
            <div className="px-6 pb-4">
              <pre className="p-4 bg-zinc-900 dark:bg-zinc-950 rounded-lg text-xs font-mono text-zinc-300 overflow-x-auto max-h-64 overflow-y-auto">
                {executionLog}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Screenshots */}
      <ScreenshotsSection
        initialScreenshots={initialScreenshots}
        workingDirectory={workingDirectory}
      />

      {/* Diff Viewer */}
      <div className="p-6 border-b border-zinc-200 dark:border-zinc-800">
        <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-4">
          変更内容
        </h4>
        <DiffViewer files={files} />
      </div>

      {/* Feedback / Change Request Section */}
      {isReadyToApprove && (
        <FeedbackSection files={files} onRequestChanges={onRequestChanges} />
      )}

      {/* Commit form and action buttons */}
      <CommitApprovalSection
        isReadyToApprove={isReadyToApprove}
        defaultBranch={defaultBranch}
        isProcessing={isProcessing}
        onApprove={onApprove}
        onReject={onReject}
      />
    </div>
  );
}

export default ExecutionReviewPanel;
