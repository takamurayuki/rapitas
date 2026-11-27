'use client';

/**
 * GoalReflectionSettingsCard
 *
 * Day and time (Asia/Tokyo) of the weekly reflection nudge. The backend keeps
 * the default (Sunday 20:00) until this is saved. Not responsible for sending
 * the nudge.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { goalReflectionApi } from '@/components/goal-reflection/goal-reflection-api';

const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export default function GoalReflectionSettingsCard() {
  const t = useTranslations('goalReflection.settings');
  const [dow, setDow] = useState(0);
  const [time, setTime] = useState('20:00');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  useEffect(() => {
    let cancelled = false;
    goalReflectionApi
      .getSettings()
      .then((s) => {
        if (cancelled) return;
        setDow(s.dow);
        setTime(s.time);
      })
      .catch(() => {
        // Keep the defaults shown; saving still works.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    setState('saving');
    try {
      await goalReflectionApi.saveSettings({ dow, time });
      setState('saved');
    } catch {
      setState('failed');
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
      <div>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t('title')}</h3>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t('description')}</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-zinc-600 dark:text-zinc-300">
          {t('dayLabel')}
          <select
            value={dow}
            onChange={(e) => {
              setDow(Number(e.target.value));
              setState('idle');
            }}
            className="mt-1 block rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
          >
            {DAYS.map((d) => (
              <option key={d} value={d}>
                {t(`days.${d}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-zinc-600 dark:text-zinc-300">
          {t('timeLabel')}
          <input
            type="time"
            aria-label={t('timeLabel')}
            value={time}
            onChange={(e) => {
              setTime(e.target.value);
              setState('idle');
            }}
            className="mt-1 block rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </label>
        <button
          type="button"
          onClick={save}
          disabled={state === 'saving' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)}
          className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {t('save')}
        </button>
        {state === 'saved' && (
          <span role="status" className="text-xs text-emerald-600 dark:text-emerald-400">
            {t('saved')}
          </span>
        )}
        {state === 'failed' && (
          <span role="alert" className="text-xs text-red-600 dark:text-red-400">
            {t('failed')}
          </span>
        )}
      </div>
    </section>
  );
}
