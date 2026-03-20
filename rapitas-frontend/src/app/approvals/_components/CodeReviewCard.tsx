/**
 * CodeReviewCard
 *
 * Renders a code-review approval request card. When expanded, delegates to
 * ExecutionReviewPanel for diff display and review actions.
 * Does not own data-fetching — the parent passes pre-fetched diff files.
 */
'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Clock, ChevronRight, Code2, GitPullRequest } from 'lucide-react';
import { ExecutionReviewPanel } from '@/feature/developer-mode/components/ExecutionReviewPanel';
import type { ApprovalRequest, FileDiff } from '@/types';
import { getTaskDetailPath } from '@/utils/tauri';

/** Tailwind colour classes keyed by approval status. */
const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  approved: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
  rejected: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  expired: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400',
};

interface CodeReviewCardProps {
  approval: ApprovalRequest;
  isExpanded: boolean;
  isProcessing: boolean;
  isPending: boolean;
  /** Pre-fetched diff files for this approval. */
  diffFiles: FileDiff[];
  onToggleExpand: () => void;
  onApprove: (commitMessage: string, baseBranch: string) => void;
  onReject: () => void;
  onRequestChanges: (
    feedback: string,
    comments: { file?: string; content: string; type: string }[],
  ) => void;
  formatDate: (date: string) => string;
  error: string | null;
}

/**
 * Card component for a code-review approval request.
 *
 * @param props - See CodeReviewCardProps
 */
export function CodeReviewCard({
  approval,
  isExpanded,
  isProcessing,
  diffFiles,
  onToggleExpand,
  onApprove,
  onReject,
  onRequestChanges,
  formatDate,
  error,
}: CodeReviewCardProps) {
  const t = useTranslations('approvals');

  const statusLabels: Record<string, string> = {
    pending: t('pending'),
    approved: t('approved'),
    rejected: t('rejected'),
    expired: t('expired'),
  };

  // NOTE: defaultBranch falls back to 'main' when no theme default is configured.
  const defaultBranch = approval.config?.task?.theme?.defaultBranch || 'main';

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      {/* Main Content */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-violet-100 dark:bg-violet-900/30 rounded-lg shrink-0">
            <Code2 className="w-5 h-5 text-violet-600 dark:text-violet-400" />
          </div>

          <div className="flex-1 min-w-0">
            {/* Header */}
            <div className="flex items-start justify-between gap-4 mb-2">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">
                    {approval.title}
                  </h3>
                  <span className="flex items-center gap-1 px-2 py-0.5 bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 rounded text-xs font-medium">
                    <GitPullRequest className="w-3 h-3" />
                    {t('codeReview')}
                  </span>
                </div>
                {approval.config?.task && (
                  <Link
                    href={getTaskDetailPath(approval.config.task.id)}
                    className="text-sm text-violet-600 dark:text-violet-400 hover:underline"
                  >
                    {t('task')}: {approval.config.task.title}
                  </Link>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[approval.status]}`}
                >
                  {statusLabels[approval.status]}
                </span>
              </div>
            </div>

            {/* Meta */}
            <div className="flex items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="flex items-center gap-1">
                <Code2 className="w-3.5 h-3.5" />
                {diffFiles.length > 0
                  ? t('filesChanged', { count: diffFiles.length })
                  : t('loadingChanges')}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {formatDate(approval.createdAt)}
              </span>
            </div>
          </div>

          {/* Expand Button */}
          <button
            onClick={onToggleExpand}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
          >
            <ChevronRight
              className={`w-5 h-5 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            />
          </button>
        </div>
      </div>

      {/* Expanded Content - ExecutionReviewPanel */}
      {isExpanded && (
        <div className="border-t border-zinc-200 dark:border-zinc-800">
          <ExecutionReviewPanel
            files={diffFiles}
            status="completed"
            onApprove={async (commitMessage, baseBranch) => {
              onApprove(commitMessage, baseBranch);
            }}
            onReject={async () => {
              onReject();
            }}
            onRequestChanges={async (feedback, comments) => {
              onRequestChanges(feedback, comments);
            }}
            isProcessing={isProcessing}
            error={error}
            defaultBranch={defaultBranch}
            implementationSummary={
              approval.proposedChanges?.implementationSummary
            }
            executionTimeMs={approval.proposedChanges?.executionTimeMs}
            taskId={approval.config?.task?.id}
            screenshots={approval.proposedChanges?.screenshots}
            workingDirectory={approval.proposedChanges?.workingDirectory}
          />
        </div>
      )}
    </div>
  );
}
