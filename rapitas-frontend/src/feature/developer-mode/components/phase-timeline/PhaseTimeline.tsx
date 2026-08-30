'use client';

/**
 * phase-timeline/PhaseTimeline
 *
 * Orchestrator for the task-detail execution log's phase timeline (task
 * #785) — replaces the flat ExecutionLogViewer in ExecutionBody with
 * research/plan/implement/verify sections. Falls back to a flat log list
 * when the backend has no phase data for this task (e.g. a manual
 * non-workflow run with no `workflow-<role>` session mode), preserving the
 * previous behaviour for that case.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Spinner } from '@/components/ui/spinner';
import { SimpleLogEntryList } from '../simple-log-entry/simple-log-entry';
import { transformLogsToSimple } from '../../utils/log-message-transformer';
import { usePhaseTimeline, type PhaseIteration } from '../../hooks/usePhaseTimeline';
import type { PhaseType } from '../../utils/phase-selector';
import { PhaseSection } from './PhaseSection';

const POLL_INTERVAL_MS = 5000;

interface TimelineSection {
  phaseType: PhaseType;
  iteration: PhaseIteration;
  totalIterationsForPhase: number;
}

export interface PhaseTimelineProps {
  taskId: number;
  isRunning: boolean;
  /** Raw flat live log lines from useExecutionManager, fed to whichever section is currently running. */
  liveLogs: string[];
}

/**
 * @param taskId - Task whose execution log to render as a phase timeline / タスクID
 * @param isRunning - Whether the task's agent is currently executing (drives polling + live tail) / 実行中かどうか
 * @param liveLogs - Raw live log lines forwarded to the running section / ライブログ行
 */
export function PhaseTimeline({ taskId, isRunning, liveLogs }: PhaseTimelineProps) {
  const t = useTranslations('phaseTimeline');
  const { phases, loading, refetch } = usePhaseTimeline(taskId);
  const [filterWarnOnly, setFilterWarnOnly] = useState(false);

  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => void refetch(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isRunning, refetch]);

  const sections: TimelineSection[] = useMemo(
    () =>
      phases.flatMap((phase) =>
        phase.iterations.map((iteration) => ({
          phaseType: phase.phaseType,
          iteration,
          totalIterationsForPhase: phase.iterations.length,
        })),
      ),
    [phases],
  );

  const runningSectionKey = useMemo(() => {
    for (let i = sections.length - 1; i >= 0; i--) {
      if (sections[i].iteration.status === 'running') {
        return `${sections[i].phaseType}-${sections[i].iteration.iterationNumber}`;
      }
    }
    return null;
  }, [sections]);

  if (loading && sections.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
        <Spinner size="sm" />
        {t('loadingDetail')}
      </div>
    );
  }

  // No phase data (non-workflow manual run, or nothing recorded yet) — fall
  // back to the flat list so this component never renders emptier than the
  // ExecutionLogViewer it replaced.
  if (sections.length === 0) {
    const entries = transformLogsToSimple(liveLogs);
    return <SimpleLogEntryList entries={entries} />;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-1 px-1">
        <button
          type="button"
          onClick={() => setFilterWarnOnly(false)}
          aria-pressed={!filterWarnOnly}
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            !filterWarnOnly
              ? 'bg-indigo-600 text-white'
              : 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
          }`}
        >
          {t('filter.all')}
        </button>
        <button
          type="button"
          onClick={() => setFilterWarnOnly(true)}
          aria-pressed={filterWarnOnly}
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            filterWarnOnly
              ? 'bg-amber-500 text-white'
              : 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
          }`}
        >
          {t('filter.warnOnly')}
        </button>
      </div>
      <div className="max-h-[420px] overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        {sections.map((section) => {
          const key = `${section.phaseType}-${section.iteration.iterationNumber}`;
          return (
            <PhaseSection
              key={key}
              phaseType={section.phaseType}
              iteration={section.iteration}
              totalIterationsForPhase={section.totalIterationsForPhase}
              filterWarnOnly={filterWarnOnly}
              liveLogLines={isRunning && key === runningSectionKey ? liveLogs : null}
            />
          );
        })}
      </div>
    </div>
  );
}
