'use client';

/**
 * GrowthClient
 *
 * /agents/daily-report orchestrator: loads the daily-report archive list, keeps the
 * selected date, fetches that day's detail, and lays out list + detail panes.
 * Missing days are simply absent from the list (no catch-up generation).
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Sunrise, AlertCircle, PauseCircle } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { Spinner } from '@/components/ui/spinner';
import ReportDetailView from './ReportDetailView';
import type { ReportDetail, ReportListItem } from './growth-types';

export default function GrowthClient() {
  const t = useTranslations('agents');
  const [reports, setReports] = useState<ReportListItem[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/growth/daily-reports`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { reports: ReportListItem[] };
        setReports(data.reports);
        if (data.reports.length > 0) setSelectedDate(data.reports[0].date);
      } catch {
        setError(t('growthLoadFailed'));
      } finally {
        setIsLoadingList(false);
      }
    })();
  }, [t]);

  const loadDetail = useCallback(
    async (date: string) => {
      setIsLoadingDetail(true);
      try {
        const res = await fetch(`${API_BASE_URL}/growth/daily-reports/${date}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { report: ReportDetail };
        setDetail(data.report);
      } catch {
        setDetail(null);
        setError(t('growthLoadFailed'));
      } finally {
        setIsLoadingDetail(false);
      }
    },
    [t],
  );

  useEffect(() => {
    if (selectedDate) void loadDetail(selectedDate);
  }, [selectedDate, loadDetail]);

  if (isLoadingList) {
    return (
      <div className="flex items-center justify-center py-20 text-zinc-400">
        <Spinner size="md" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-1 flex items-center gap-2 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
        <Sunrise className="h-6 w-6 text-amber-500" />
        {t('growthTitle')}
      </div>
      <p className="mb-5 text-sm text-zinc-500 dark:text-zinc-400">{t('growthDescription')}</p>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {reports.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 px-6 py-16 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          {t('growthEmpty')}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
          {/* Archive list */}
          <div className="space-y-1.5 lg:max-h-[calc(100vh-14rem)] lg:overflow-y-auto lg:pr-1 scrollbar-thin">
            {reports.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelectedDate(r.date)}
                className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                  r.date === selectedDate
                    ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-900/30'
                    : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800'
                }`}
              >
                <div className="flex items-center gap-1.5 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {r.date}
                  {r.satiated && <PauseCircle className="h-3.5 w-3.5 text-amber-500" />}
                </div>
                <div className="mt-0.5 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
                  {r.summary}
                </div>
              </button>
            ))}
          </div>

          {/* Detail pane */}
          <div>
            {isLoadingDetail ? (
              <div className="flex items-center justify-center py-20 text-zinc-400">
                <Spinner size="md" />
              </div>
            ) : detail ? (
              <ReportDetailView report={detail} />
            ) : (
              <div className="rounded-xl border border-dashed border-zinc-300 px-6 py-16 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                {t('growthSelectPrompt')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
