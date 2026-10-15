'use client';

/**
 * SlotLogList
 *
 * Paged calendar_slot.* execution log (hold start / release / recompute /
 * sync failure) for the calendar-slot dashboard (task 1174). Uses the shared
 * Pagination component (COMPONENT_SPLITTING_POLICY §7-1).
 */
import { useTranslations } from 'next-intl';
import Pagination from '@/components/ui/pagination/Pagination';
import type { SlotLogsResponse } from './calendar-slots-types';

const ACTION_PREFIX = 'calendar_slot.';

function summarize(metadata: Record<string, unknown>): string {
  return [
    'themeId',
    'taskId',
    'checkpoint',
    'reason',
    'cause',
    'releaseAt',
    'nextRunAt',
    'blockCount',
    'error',
  ]
    .filter((k) => metadata[k] !== undefined && metadata[k] !== null)
    .map((k) => `${k}=${String(metadata[k])}`)
    .join(' · ');
}

export default function SlotLogList({
  data,
  page,
  limit,
  onPageChange,
  onLimitChange,
}: {
  data: SlotLogsResponse;
  page: number;
  limit: number;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
}) {
  const t = useTranslations('calendarSlots');
  const totalPages = Math.max(1, Math.ceil(data.total / limit));

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
      <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {t('logsTitle')}
      </h2>
      {data.items.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('logsEmpty')}</p>
      ) : (
        <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
          {data.items.map((item) => (
            <li key={item.id} className="flex flex-col gap-0.5 py-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  {t(`action.${item.action.replace(ACTION_PREFIX, '')}`)}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {new Date(item.createdAt).toLocaleString()}
                </span>
              </div>
              <span className="break-all text-xs text-zinc-600 dark:text-zinc-400">
                {summarize(item.metadata)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3">
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          itemsPerPage={limit}
          onPageChange={onPageChange}
          onItemsPerPageChange={onLimitChange}
          itemsPerPageOptions={[10, 20, 50]}
        />
      </div>
    </section>
  );
}
