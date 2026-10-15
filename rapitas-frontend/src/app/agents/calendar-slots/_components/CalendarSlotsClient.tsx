'use client';

/**
 * CalendarSlotsClient
 *
 * /agents/calendar-slots orchestrator (task 1174): next run schedule, sync
 * state and the paged execution log of the calendar-aware auto-run gate.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarSearch } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { useCalendarSlotsData } from './useCalendarSlotsData';
import NextRunsCard from './NextRunsCard';
import SyncStateCard from './SyncStateCard';
import SlotLogList from './SlotLogList';

export default function CalendarSlotsClient() {
  const t = useTranslations('calendarSlots');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const { nextRuns, syncState, logs, loading, error, reload } = useCalendarSlotsData(page, limit);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-1 flex items-center gap-2 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
        <CalendarSearch className="h-6 w-6 text-indigo-500" />
        {t('title')}
      </div>
      <p className="mb-5 text-sm text-zinc-500 dark:text-zinc-400">{t('description')}</p>

      {loading && (
        <div className="flex items-center justify-center py-20 text-zinc-400">
          <Spinner size="md" />
        </div>
      )}
      {!loading && error && (
        <p className="rounded bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {t('loadFailed')}
        </p>
      )}
      {!loading && !error && nextRuns && syncState && logs && (
        <div className="grid gap-4 lg:grid-cols-2">
          <NextRunsCard data={nextRuns} />
          <SyncStateCard data={syncState} onSynced={() => void reload()} />
          <div className="lg:col-span-2">
            <SlotLogList
              data={logs}
              page={page}
              limit={limit}
              onPageChange={setPage}
              onLimitChange={(n) => {
                setLimit(n);
                setPage(1);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
