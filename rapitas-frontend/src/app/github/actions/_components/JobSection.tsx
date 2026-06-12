'use client';

/**
 * JobSection
 *
 * A job row that expands into its steps (grandchildren). The first time any
 * step is expanded, the job's per-step logs are fetched once and cached; the
 * step expands only after that load completes. Owns step expansion + log state;
 * the parent run owns whether this job is expanded.
 */

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { StatusIcon } from './StatusIcon';
import { StepRow } from './StepRow';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import type { RunJob, JobLogSection } from '../_types/actions.types';

const logger = createLogger('JobSection');

interface JobSectionProps {
  job: RunJob;
  /** Selected integration id, used to build the job-log fetch URL. / 連携ID */
  integrationId: string;
  isExpanded: boolean;
  onToggle: () => void;
}

/**
 * Render one job with its expandable, log-bearing steps.
 *
 * @param props - job data, integration id, and expand state / ジョブと展開状態
 */
export function JobSection({ job, integrationId, isExpanded, onToggle }: JobSectionProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const [sections, setSections] = useState<JobLogSection[] | null>(null);
  const [loadingStep, setLoadingStep] = useState<number | null>(null);

  const collapseStep = (stepNumber: number) =>
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      next.delete(stepNumber);
      return next;
    });

  const toggleStep = async (stepNumber: number) => {
    if (expandedSteps.has(stepNumber)) {
      collapseStep(stepNumber);
      return;
    }
    if (loadingStep !== null) return; // a log fetch is already in flight
    // Lazily fetch the job's per-step logs once; expand only after it resolves.
    if (!sections) {
      setLoadingStep(stepNumber);
      try {
        const res = await fetch(
          `${API_BASE_URL}/github/integrations/${integrationId}/jobs/${job.databaseId}/log`,
        );
        const data = res.ok ? ((await res.json()) as { sections?: JobLogSection[] }) : null;
        setSections(data?.sections ?? []);
      } catch (err) {
        logger.error('Failed to fetch job log:', err);
        setSections([]);
      } finally {
        setLoadingStep(null);
      }
    }
    setExpandedSteps((prev) => new Set(prev).add(stepNumber));
  };

  return (
    <div className="rounded-md border border-zinc-100 dark:border-zinc-700/50">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
      >
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
        />
        <StatusIcon status={job.status} conclusion={job.conclusion} className="h-3.5 w-3.5" />
        <span className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-200">
          {job.name}
        </span>
        <span className="ml-auto shrink-0 text-[10px] text-zinc-400">
          {job.steps.length} ステップ
        </span>
      </button>
      {isExpanded && (
        <div className="space-y-1 px-2.5 pb-2 pl-8">
          {job.steps.length === 0 ? (
            <p className="text-[11px] text-zinc-400">ステップ情報がありません</p>
          ) : (
            job.steps.map((step) => (
              <StepRow
                key={step.number}
                step={step}
                isExpanded={expandedSteps.has(step.number)}
                isLoadingLog={loadingStep === step.number}
                section={sections?.find((s) => s.number === step.number)}
                onToggle={() => toggleStep(step.number)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
