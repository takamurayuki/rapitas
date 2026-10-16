'use client';

/**
 * NextRunsCard
 *
 * Shows the calendar gate's current decision, the next time auto-run may
 * start new work, held themes, and the upcoming free slots (task 1174).
 */
import { useTranslations } from 'next-intl';
import type { NextRunsResponse } from './calendar-slots-types';

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

export default function NextRunsCard({ data }: { data: NextRunsResponse }) {
  const t = useTranslations('calendarSlots');
  const gateLabel = !data.enabled ? 'gateDisabled' : data.gate.hold ? 'gateHeld' : 'gateFree';
  const gateTone = data.gate.hold
    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300';

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {t('nextRunsTitle')}
        </h2>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${gateTone}`}>
          {t(gateLabel)}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-zinc-500 dark:text-zinc-400">{t('nextRunAt')}</dt>
        <dd data-testid="next-run-at" className="text-zinc-900 dark:text-zinc-100">
          {data.nextRunAt ? fmt(data.nextRunAt) : t('noFreeSlot')}
        </dd>
        <dt className="text-zinc-500 dark:text-zinc-400">{t('leadMinutes')}</dt>
        <dd className="text-zinc-900 dark:text-zinc-100">{data.leadMinutes}</dd>
        <dt className="text-zinc-500 dark:text-zinc-400">{t('busyCount')}</dt>
        <dd className="text-zinc-900 dark:text-zinc-100">{data.busyBlocks.length}</dd>
      </dl>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{t('runningPhaseNote')}</p>

      {data.holds.length > 0 && (
        <div className="mt-3">
          <h3 className="mb-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            {t('heldThemes')}
          </h3>
          <ul className="space-y-1 text-sm">
            {data.holds.map((h) => (
              <li
                key={h.themeId}
                data-testid={`held-theme-${h.themeId}`}
                className="text-zinc-800 dark:text-zinc-200"
              >
                #{h.themeId} — {t('releaseAt')}: {fmt(h.releaseAt)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3">
        <h3 className="mb-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
          {t('freeSlots')}
        </h3>
        {data.freeSlots.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('noFreeSlot')}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.freeSlots.slice(0, 10).map((s) => (
              <li
                key={s.startAt}
                data-testid="free-slot"
                className="text-zinc-800 dark:text-zinc-200"
              >
                {fmt(s.startAt)} – {fmt(s.endAt)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
