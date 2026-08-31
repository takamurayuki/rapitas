'use client';

/**
 * phase-timeline/PhaseTabPane
 *
 * The log pane for ONE phase iteration inside the tabbed execution-log view
 * (task #796 redesign of #785). Always expanded — tab selection replaces the
 * old accordion — and styled as a terminal: forced-dark, monospace, dark
 * canvas regardless of the app theme.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowDown } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { transformLogsToSimple } from '../../utils/log-message-transformer';
import type { PhaseIteration } from '../../hooks/usePhaseTimeline';
import { usePhaseLogStreaming } from '../../hooks/usePhaseLogStreaming';

import { SimpleLogEntryList } from '../simple-log-entry/simple-log-entry';

// Speech bubbles live in SimpleLogEntryList (the pre-#785 renderer users
// asked for); the virtualized PhaseLogViewer dropped them. Cap the tail so a
// huge iteration doesn't mount thousands of DOM rows.
const MAX_RENDERED_ENTRIES = 1500;

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

export interface PhaseTabPaneProps {
  iteration: PhaseIteration;
  filterWarnOnly: boolean;
  /** Raw live lines when this iteration is currently running; null → lazy-fetch its stored logs. */
  liveLogLines: string[] | null;
}

/**
 * @param iteration - The iteration whose logs to show / 表示する反復
 * @param filterWarnOnly - "⚠のみ" filter state / 警告のみフィルタ
 * @param liveLogLines - Live tail lines while running, else null / 実行中のライブ行
 */
export function PhaseTabPane({ iteration, filterWarnOnly, liveLogLines }: PhaseTabPaneProps) {
  const t = useTranslations('phaseTimeline');
  const [fetchedLogs, setFetchedLogs] = useState<string[] | null>(null);
  const [fetchError, setFetchError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const isLive = liveLogLines !== null;

  // Iteration switched (tab / repair selector) — drop the previous logs.
  const iterKey = iteration.executionIds.join(',');
  useEffect(() => {
    setFetchedLogs(null);
    setFetchError(false);
  }, [iterKey]);

  useEffect(() => {
    if (isLive || fetchedLogs !== null || fetchError) return;
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
  }, [isLive, fetchedLogs, fetchError, iteration.executionIds]);

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

  return (
    // Forced-dark terminal canvas: `.dark` (class-strategy variant) makes the
    // shared row styles resolve to their dark palette on every app theme.
    <div className="dark relative bg-zinc-950 font-mono">
      {fetchError ? (
        <div className="px-3 py-4 text-xs text-red-400">{t('loadFailed')}</div>
      ) : !isLive && fetchedLogs === null ? (
        <div className="px-3 py-4 text-xs text-zinc-500">{t('loadingDetail')}</div>
      ) : filteredEntries.length === 0 ? (
        <div className="px-3 py-4 text-xs text-zinc-500">{t('noLogsYet')}</div>
      ) : (
        <div
          ref={containerRef}
          onScroll={isLive ? handleScroll : undefined}
          className="max-h-[340px] overflow-y-auto px-1 py-1"
        >
          <SimpleLogEntryList entries={filteredEntries.slice(-MAX_RENDERED_ENTRIES)} />
        </div>
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
  );
}
