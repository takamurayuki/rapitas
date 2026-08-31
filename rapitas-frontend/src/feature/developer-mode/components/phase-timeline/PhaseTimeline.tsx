'use client';

/**
 * phase-timeline/PhaseTimeline
 *
 * Tabbed execution-log view (task #796, redesigned from #785's accordion on
 * operator feedback: expanding every section was tedious and tall). One tab
 * per phase, the running phase auto-selected, logs rendered as a forced-dark
 * terminal. Falls back to a flat log list when the backend has no phase data
 * for this task (manual non-workflow runs).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Spinner } from '@/components/ui/spinner';
import { SimpleLogEntryList } from '../simple-log-entry/simple-log-entry';
import { transformLogsToSimple } from '../../utils/log-message-transformer';
import { usePhaseTimeline } from '../../hooks/usePhaseTimeline';
import type { PhaseType } from '../../utils/phase-selector';
import { PhaseTabBar, type PhaseTabInfo } from './PhaseTabBar';
import { PhaseTabPane } from './PhaseTabPane';
import { formatPhaseSummary } from './format-phase-summary';

const POLL_INTERVAL_MS = 5000;

export interface PhaseTimelineProps {
  taskId: number;
  isRunning: boolean;
  /** Raw flat live log lines from useExecutionManager, fed to the running iteration's pane. */
  liveLogs: string[];
}

/**
 * @param taskId - Task whose execution log to render / タスクID
 * @param isRunning - Whether the task's agent is currently executing (drives polling + live tail) / 実行中かどうか
 * @param liveLogs - Raw live log lines forwarded to the running pane / ライブログ行
 */
export function PhaseTimeline({ taskId, isRunning, liveLogs }: PhaseTimelineProps) {
  const t = useTranslations('phaseTimeline');
  const { phases, loading, refetch } = usePhaseTimeline(taskId);
  const [filterWarnOnly, setFilterWarnOnly] = useState(false);
  const [selectedPhase, setSelectedPhase] = useState<PhaseType | null>(null);
  const [selectedIteration, setSelectedIteration] = useState<number | null>(null);
  // Once the user picks a tab by hand, stop auto-following the running phase
  // until they jump back ("実行中へ").
  const manualNavRef = useRef(false);

  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => void refetch(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isRunning, refetch]);

  const runningPhase = useMemo<PhaseType | null>(() => {
    for (const phase of phases) {
      if (phase.iterations.some((it) => it.status === 'running')) return phase.phaseType;
    }
    return null;
  }, [phases]);

  // Auto-follow: select the running phase (or the last phase with data) while
  // the user hasn't navigated manually.
  useEffect(() => {
    if (manualNavRef.current) return;
    const target = runningPhase ?? phases[phases.length - 1]?.phaseType ?? null;
    if (target && target !== selectedPhase) {
      setSelectedPhase(target);
      setSelectedIteration(null);
    }
  }, [runningPhase, phases, selectedPhase]);

  const tabs = useMemo<PhaseTabInfo[]>(
    () =>
      phases.map((phase) => ({
        phaseType: phase.phaseType,
        latestStatus: phase.iterations[phase.iterations.length - 1]?.status ?? 'completed',
        iterationCount: phase.iterations.length,
      })),
    [phases],
  );

  const currentPhase = phases.find((p) => p.phaseType === selectedPhase) ?? null;
  const iterations = currentPhase?.iterations ?? [];
  // Default to the running iteration, else the latest.
  const activeIterationNumber =
    selectedIteration ??
    iterations.find((it) => it.status === 'running')?.iterationNumber ??
    iterations[iterations.length - 1]?.iterationNumber ??
    1;
  const activeIteration =
    iterations.find((it) => it.iterationNumber === activeIterationNumber) ?? null;

  const paneIsLive =
    isRunning && currentPhase?.phaseType === runningPhase && activeIteration?.status === 'running';

  if (loading && phases.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
        <Spinner size="sm" />
        {t('loadingDetail')}
      </div>
    );
  }

  // No phase data — fall back to the flat list (manual non-workflow runs).
  if (phases.length === 0) {
    const entries = transformLogsToSimple(liveLogs);
    return <SimpleLogEntryList entries={entries} />;
  }

  const summaryText = activeIteration
    ? formatPhaseSummary(activeIteration.summary, currentPhase!.phaseType, t)
    : null;

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900">
      {/* Terminal-style header: status/summary left, filters right */}
      <div className="flex items-center justify-between gap-2 border-b border-zinc-700/70 bg-zinc-900 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2 text-[11px] text-zinc-400">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              runningPhase ? 'animate-pulse bg-emerald-400' : 'bg-zinc-600'
            }`}
          />
          <span className="truncate font-mono">
            {runningPhase
              ? `${t(`phaseLabel.${runningPhase}`)} ${t('status.running')}`
              : (summaryText ?? t('status.completed'))}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {manualNavRef.current && runningPhase && selectedPhase !== runningPhase && (
            <button
              type="button"
              onClick={() => {
                manualNavRef.current = false;
                setSelectedPhase(runningPhase);
                setSelectedIteration(null);
              }}
              className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-500"
            >
              {t('jumpToRunning')}
            </button>
          )}
          <button
            type="button"
            onClick={() => setFilterWarnOnly(false)}
            aria-pressed={!filterWarnOnly}
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              !filterWarnOnly ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:bg-zinc-800'
            }`}
          >
            {t('filter.all')}
          </button>
          <button
            type="button"
            onClick={() => setFilterWarnOnly(true)}
            aria-pressed={filterWarnOnly}
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              filterWarnOnly ? 'bg-amber-500 text-white' : 'text-zinc-400 hover:bg-zinc-800'
            }`}
          >
            {t('filter.warnOnly')}
          </button>
        </div>
      </div>

      <div className="bg-zinc-900">
        <PhaseTabBar
          tabs={tabs}
          selected={selectedPhase ?? tabs[0]?.phaseType ?? 'research'}
          onSelect={(phase) => {
            manualNavRef.current = phase !== runningPhase;
            setSelectedPhase(phase);
            setSelectedIteration(null);
          }}
        />
      </div>

      {iterations.length > 1 && (
        <div className="flex items-center gap-1 border-b border-zinc-800 bg-zinc-950 px-3 py-1">
          {iterations.map((it) => (
            <button
              key={it.iterationNumber}
              type="button"
              onClick={() => setSelectedIteration(it.iterationNumber)}
              aria-pressed={it.iterationNumber === activeIterationNumber}
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                it.iterationNumber === activeIterationNumber
                  ? 'bg-zinc-700 text-zinc-100'
                  : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
              }`}
            >
              {t('iterationChip', { n: it.iterationNumber })}
            </button>
          ))}
        </div>
      )}

      {activeIteration && (
        <PhaseTabPane
          iteration={activeIteration}
          filterWarnOnly={filterWarnOnly}
          liveLogLines={paneIsLive ? liveLogs : null}
        />
      )}
    </div>
  );
}
