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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Terminal, Search, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { SimpleLogEntryList } from '../simple-log-entry/simple-log-entry';
import { transformLogsToSimple } from '../../utils/log-message-transformer';
import { usePhaseTimeline } from '../../hooks/usePhaseTimeline';
import type { PhaseType } from '../../utils/phase-selector';
import { PhaseTabBar, type PhaseTabInfo } from './PhaseTabBar';
import { PhaseTabPane, type SearchMode } from './PhaseTabPane';

const POLL_INTERVAL_MS = 5000;
const SEARCH_DEBOUNCE_MS = 200;

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
  // Reuse the original log-viewer header vocabulary (実行ログ + status labels)
  // so the tabbed view keeps the pre-#785 header composition.
  const tHeader = useTranslations('devMode.logViewerHeader');
  const { phases, loading, refetch } = usePhaseTimeline(taskId);
  const [filterWarnOnly, setFilterWarnOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('partial');
  const [matchCount, setMatchCount] = useState(0);
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

  // Debounce so the (potentially large) filter/highlight pass doesn't run per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const runningPhase = useMemo<PhaseType | null>(() => {
    for (const phase of phases) {
      if (phase.iterations.some((it) => it.status === 'running')) return phase.phaseType;
    }
    return null;
  }, [phases]);

  // Overall outcome for the header badge: failed when the LAST iteration of
  // any phase ended failed (repaired failures don't count).
  const overallFailed = useMemo(
    () =>
      phases.some((phase) => phase.iterations[phase.iterations.length - 1]?.status === 'failed'),
    [phases],
  );

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

  const handleMatchCount = useCallback((n: number) => setMatchCount(n), []);

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

  const statusBadge = runningPhase ? (
    <span className="flex items-center gap-1.5 rounded bg-blue-500/20 px-2 py-0.5 text-xs text-blue-400">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
      {tHeader('statusRunning')}
    </span>
  ) : overallFailed ? (
    <span className="flex items-center gap-1 rounded bg-red-500/20 px-2 py-0.5 text-xs text-red-400">
      <AlertCircle className="h-3 w-3" />
      {tHeader('statusFailed')}
    </span>
  ) : (
    <span className="flex items-center gap-1 rounded bg-green-500/20 px-2 py-0.5 text-xs text-green-400">
      <CheckCircle2 className="h-3 w-3" />
      {tHeader('statusCompleted')}
    </span>
  );

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900">
      {/* Header: 実行ログ title + overall status badge (pre-#785 composition), search + filters right */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-700/70 bg-zinc-800 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <Terminal className="h-4 w-4 shrink-0 text-green-400" />
          <span className="text-sm font-medium text-zinc-200">{tHeader('title')}</span>
          {statusBadge}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setSearchQuery('');
              }}
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchPlaceholder')}
              className="w-56 rounded border border-zinc-600 bg-zinc-900 py-1 pl-7 pr-6 text-xs text-zinc-200 transition-all placeholder:text-zinc-500 focus:w-72 focus:border-indigo-400 focus:outline-none"
            />
            <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-500" />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label={t('clearSearch')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <select
            value={searchMode}
            onChange={(e) => setSearchMode(e.target.value as SearchMode)}
            aria-label={t('searchModeLabel')}
            className="rounded border border-zinc-600 bg-zinc-900 px-1 py-1 text-[11px] text-zinc-300 focus:border-indigo-400 focus:outline-none"
          >
            <option value="partial">{t('searchMode.partial')}</option>
            <option value="exact">{t('searchMode.exact')}</option>
            <option value="regex">{t('searchMode.regex')}</option>
          </select>
          {debouncedQuery.trim() && (
            <span
              className={`whitespace-nowrap text-[11px] ${
                matchCount > 0 ? 'text-zinc-400' : 'text-amber-400'
              }`}
            >
              {t('matchCount', { count: matchCount })}
            </span>
          )}
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
          searchQuery={debouncedQuery}
          searchMode={searchMode}
          onMatchCount={handleMatchCount}
          isLive={paneIsLive === true}
          liveSignal={liveLogs.length}
        />
      )}
    </div>
  );
}
