'use client';

/**
 * phase-timeline/PhaseSection
 *
 * One collapsible section of the phase timeline (task #785) — one repair
 * iteration of one phase (e.g. "実装 (2回目)"). Auto-expands while running,
 * auto-collapses to a 1-line summary once it finishes. Completed sections
 * fetch their log detail lazily (only when the user expands them) rather
 * than holding it in memory up front.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowDown } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { transformLogsToSimple } from '../../utils/log-message-transformer';
import type { PhaseType } from '../../utils/phase-selector';
import type { PhaseIteration } from '../../hooks/usePhaseTimeline';
import { usePhaseLogStreaming } from '../../hooks/usePhaseLogStreaming';
import { PhaseSectionHeader } from './PhaseSectionHeader';
import dynamic from 'next/dynamic';

// NOTE: dynamic import keeps react-window and the virtualized viewer out of
// the eager shared chunk — the static import pushed one chunk to 807 KB
// against the 500 KB eager budget. Logs render client-side only anyway.
const PhaseLogViewer = dynamic(() => import('./PhaseLogViewer').then((m) => m.PhaseLogViewer), {
  ssr: false,
});
import { formatPhaseSummary } from './format-phase-summary';

interface ExecutionLogEntryRow {
  logChunk: string;
}

async function fetchExecutionLogLines(executionId: number): Promise<string[]> {
  const res = await fetch(`${API_BASE_URL}/agents/executions/${executionId}/logs?limit=2000`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { success: boolean; logs?: ExecutionLogEntryRow[] };
  if (!data.success || !data.logs) throw new Error('malformed response');
  return data.logs.flatMap((l) => l.logChunk.split('\n'));
}

export interface PhaseSectionProps {
  phaseType: PhaseType;
  iteration: PhaseIteration;
  totalIterationsForPhase: number;
  filterWarnOnly: boolean;
  /** Raw live log lines for this iteration when it's the currently-running one; null otherwise (lazy-fetch instead). */
  liveLogLines: string[] | null;
}

/**
 * @param phaseType - Which timeline phase this section belongs to / フェーズ種別
 * @param iteration - This section's iteration data (status, timestamps, summary) / 反復データ
 * @param totalIterationsForPhase - Total iterations this phase has — controls the "(N回目)" suffix / フェーズの総反復数
 * @param filterWarnOnly - Whether the "⚠のみ" filter is active / 警告のみフィルタの状態
 * @param liveLogLines - Live tail lines when this is the running iteration, else null / ライブログ行(実行中のみ)
 */
export function PhaseSection({
  phaseType,
  iteration,
  totalIterationsForPhase,
  filterWarnOnly,
  liveLogLines,
}: PhaseSectionProps) {
  const t = useTranslations('phaseTimeline');
  const [expanded, setExpanded] = useState(iteration.status === 'running');
  const prevStatusRef = useRef(iteration.status);
  const [fetchedLogs, setFetchedLogs] = useState<string[] | null>(null);
  const [fetchError, setFetchError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-expand when this section starts running; auto-collapse once it
  // leaves the running state — but don't fight a manual toggle within the
  // same status (plan.md エッジケースの方針: 実行中は自動展開/完了は自動折りたたみ).
  useEffect(() => {
    if (prevStatusRef.current !== iteration.status) {
      setExpanded(iteration.status === 'running');
      prevStatusRef.current = iteration.status;
    }
  }, [iteration.status]);

  const isLive = liveLogLines !== null;

  useEffect(() => {
    if (isLive || !expanded || fetchedLogs !== null || fetchError) return;
    let cancelled = false;
    Promise.all(iteration.executionIds.map(fetchExecutionLogLines))
      .then((groups) => {
        if (!cancelled) setFetchedLogs(groups.flat());
      })
      .catch(() => {
        if (!cancelled) setFetchError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isLive, expanded, fetchedLogs, fetchError, iteration.executionIds]);

  const rawLogs = useMemo(() => liveLogLines ?? fetchedLogs ?? [], [liveLogLines, fetchedLogs]);
  const entries = useMemo(() => transformLogsToSimple(rawLogs), [rawLogs]);
  const filteredEntries = useMemo(
    () =>
      filterWarnOnly
        ? entries.filter((e) => e.category === 'error' || e.category === 'warning')
        : entries,
    [entries, filterWarnOnly],
  );

  const { autoScroll, handleScroll, handleScrollStart, handleScrollEnd, scrollToBottom } =
    usePhaseLogStreaming(isLive ? rawLogs.length : 0, containerRef);

  const summaryText = useMemo(
    () => formatPhaseSummary(iteration.summary, phaseType, t),
    [iteration.summary, phaseType, t],
  );

  const toggle = useCallback(() => setExpanded((v) => !v), []);

  return (
    <div className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
      <PhaseSectionHeader
        phaseType={phaseType}
        iterationNumber={iteration.iterationNumber}
        totalIterations={totalIterationsForPhase}
        status={iteration.status}
        summaryText={summaryText}
        expanded={expanded}
        onToggle={toggle}
        boundaryUncertain={iteration.boundaryUncertain}
      />
      {expanded && (
        <div className="relative">
          {fetchError ? (
            <div className="px-3 py-4 text-xs text-red-500">{t('loadFailed')}</div>
          ) : !isLive && fetchedLogs === null ? (
            <div className="px-3 py-4 text-xs text-zinc-500">{t('loadingDetail')}</div>
          ) : (
            <PhaseLogViewer
              entries={filteredEntries}
              outerRef={containerRef}
              onScroll={isLive ? handleScroll : undefined}
            />
          )}
          {isLive && !autoScroll && (
            <button
              type="button"
              onClick={scrollToBottom}
              onMouseDown={handleScrollStart}
              onMouseUp={handleScrollEnd}
              className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-indigo-600 px-2.5 py-1 text-[11px] text-white shadow-lg hover:bg-indigo-500"
            >
              <ArrowDown className="h-3 w-3" />
              {t('scrollToBottom')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
