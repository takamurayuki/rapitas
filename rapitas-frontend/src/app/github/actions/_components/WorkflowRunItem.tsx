'use client';

/**
 * WorkflowRunItem
 *
 * One CI/CD workflow-run row. Expands — only after its detail has loaded — into
 * a per-job expandable menu; each job in turn reveals its steps with pass/fail
 * status icons. Presentational: the parent owns fetching and passes the loaded
 * detail plus expand/loading state in.
 */

import { ChevronRight, ExternalLink, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { StatusIcon } from './StatusIcon';
import { JobSection } from './JobSection';
import type { WorkflowRun, RunDetail } from '../_types/actions.types';

interface WorkflowRunItemProps {
  run: WorkflowRun;
  /** Selected integration id, forwarded to jobs for log fetching. / 連携ID */
  integrationId: string;
  /** Loaded detail (jobs/steps), or undefined until the run is expanded. / 読込済み詳細 */
  detail: RunDetail | undefined;
  isExpanded: boolean;
  /** True while the detail fetch is in flight — the chevron shows a spinner. / 詳細読込中 */
  isLoadingDetail: boolean;
  /** Set of expanded job databaseIds (shared across runs; ids are unique). / 展開中ジョブ */
  expandedJobs: Set<number>;
  dateLocale: string;
  onToggle: () => void;
  onToggleJob: (jobId: number) => void;
}

/**
 * Render one workflow-run row with nested job/step expansion.
 *
 * @param props - run data, loaded detail, and expand/loading callbacks / 実行データと展開状態
 */
export function WorkflowRunItem({
  run,
  integrationId,
  detail,
  isExpanded,
  isLoadingDetail,
  expandedJobs,
  dateLocale,
  onToggle,
  onToggleJob,
}: WorkflowRunItemProps) {
  const t = useTranslations('github');
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50">
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-2.5 text-left">
        {/* While loading the detail, swap the chevron for a spinner — the row
            does not expand until the fetch resolves. */}
        {isLoadingDetail ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-400" />
        ) : (
          <ChevronRight
            className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          />
        )}
        <StatusIcon status={run.status} conclusion={run.conclusion} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {run.workflowName}
            </span>
            <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {run.displayTitle}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-400">
            <span className="rounded bg-zinc-100 px-1 py-0.5 font-mono dark:bg-zinc-800">
              {run.headBranch}
            </span>
            <span>{run.event}</span>
            <span>{new Date(run.createdAt).toLocaleString(dateLocale)}</span>
          </div>
        </div>
        <a
          href={run.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
          title={t('openInGitHub')}
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </button>

      {isExpanded && detail && (
        <div className="space-y-1.5 border-t border-zinc-100 px-4 py-3 dark:border-zinc-700/50">
          {detail.jobs.length === 0 ? (
            <p className="text-xs text-zinc-400">{t('workflowRunItem.noJobs')}</p>
          ) : (
            detail.jobs.map((job) => (
              <JobSection
                key={job.databaseId}
                job={job}
                integrationId={integrationId}
                isExpanded={expandedJobs.has(job.databaseId)}
                onToggle={() => onToggleJob(job.databaseId)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
