'use client';
/**
 * TaskBulkCleanup
 *
 * Clearing tasks away by condition rather than by judgement.
 *
 * The other cleanup mode asks a model which tasks are redundant, from a
 * window of sixty. Measured on the rapitas theme — 719 tasks, 10 of them
 * inside that window — judgement is the wrong instrument for housekeeping at
 * this size: it cannot see most of what you are asking about.
 *
 * So this one states the conditions, shows every match it carries, and
 * deletes the ones left ticked. Nothing is removed that was not on screen,
 * and all of it goes to the trash, so a wrong filter is one press to undo.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2, Undo2 } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { useDeleteFilter } from './use-delete-filter';

/** Statuses offered, in the order a clear-out usually wants them. */
const STATUSES = ['cancelled', 'done', 'blocked', 'todo'] as const;

/** Age options, in days. 0 means "any age". */
const AGES = [0, 30, 90, 180] as const;

interface ThemeOption {
  id: number;
  name: string;
}

export function TaskBulkCleanup() {
  const t = useTranslations('rapiAvatar.bulk');
  const [themes, setThemes] = useState<ThemeOption[]>([]);
  const [themeId, setThemeId] = useState<number | undefined>(undefined);
  const [statuses, setStatuses] = useState<string[]>(['cancelled']);
  const [days, setDays] = useState<number>(90);

  const {
    matches,
    chosen,
    total,
    truncated,
    excludedProtected,
    previewing,
    removing,
    progress,
    error,
    results,
    undoable,
    preview,
    toggle,
    removeChosen,
    undo,
    reset,
  } = useDeleteFilter();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/themes`);
        const data = (await res.json()) as ThemeOption[] | { data?: ThemeOption[] };
        const list = Array.isArray(data) ? data : (data.data ?? []);
        if (!cancelled) setThemes(list.map((x) => ({ id: x.id, name: x.name })));
      } catch {
        // A theme list that will not load leaves the picker empty; the filter
        // still works across every theme.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleStatus = (s: string) =>
    setStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const deleted = results?.filter((r) => r.outcome === 'deleted') ?? [];
  const refused = results?.filter((r) => r.outcome !== 'deleted') ?? [];
  const field =
    'w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100';

  return (
    <section className="space-y-2 p-2">
      <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">{t('title')}</h3>

      {matches.length === 0 && !results && (
        <div className="space-y-2">
          <label className="block space-y-1">
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{t('theme')}</span>
            <select
              className={field}
              aria-label={t('theme')}
              value={themeId ?? ''}
              onChange={(e) => setThemeId(e.target.value ? Number(e.target.value) : undefined)}
            >
              <option value="">{t('anyTheme')}</option>
              {themes.map((th) => (
                <option key={th.id} value={th.id}>
                  {th.name}
                </option>
              ))}
            </select>
          </label>

          <div className="space-y-1">
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{t('status')}</span>
            <div className="flex flex-wrap gap-1">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleStatus(s)}
                  aria-pressed={statuses.includes(s)}
                  className={`rounded-full px-2 py-0.5 text-[11px] transition-colors ${
                    statuses.includes(s)
                      ? 'bg-zinc-700 text-white dark:bg-zinc-200 dark:text-zinc-900'
                      : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                  }`}
                >
                  {t(`statusLabel.${s}`)}
                </button>
              ))}
            </div>
          </div>

          <label className="block space-y-1">
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{t('age')}</span>
            <select
              className={field}
              aria-label={t('age')}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              {AGES.map((d) => (
                <option key={d} value={d}>
                  {d === 0 ? t('anyAge') : t('olderThan', { days: d })}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() =>
              void preview({ themeId, statuses, updatedBeforeDays: days > 0 ? days : undefined })
            }
            disabled={previewing || statuses.length === 0}
            className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {previewing ? t('counting') : t('preview')}
          </button>
        </div>
      )}

      {matches.length > 0 && (
        <div className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-800/50">
          <p className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
            {t('matched', { total })}
          </p>
          {truncated && (
            <p className="text-[10px] text-amber-700 dark:text-amber-400">
              {t('truncated', { shown: matches.length })}
            </p>
          )}
          {excludedProtected > 0 && (
            <p className="text-[10px] text-zinc-500">
              {t('protectedExcluded', { count: excludedProtected })}
            </p>
          )}

          <ul className="max-h-52 space-y-1 overflow-y-auto">
            {matches.map((m) => (
              <li key={m.id} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={chosen.has(m.id)}
                  onChange={() => toggle(m.id)}
                  aria-label={m.title}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] text-zinc-800 dark:text-zinc-100">
                    {m.title}
                  </span>
                  <span className="block text-[10px] text-zinc-400">
                    {m.status} · {String(m.updatedAt).slice(0, 10)}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => void removeChosen()}
              disabled={chosen.size === 0 || removing}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {removing && progress
                ? t('removingBatch', { done: progress.done, of: progress.of })
                : t('remove', { count: chosen.size })}
            </button>
            <button
              type="button"
              onClick={reset}
              className="rounded-lg px-3 py-1.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      )}

      {results && (
        <div className="space-y-1.5 rounded-lg border border-zinc-200 p-2 dark:border-zinc-700">
          <p className="text-[11px] text-zinc-700 dark:text-zinc-200">
            {t('removed', { count: deleted.length })}
          </p>
          {refused.length > 0 && (
            <p className="text-[10px] text-amber-700 dark:text-amber-400">
              {t('keptBack', { count: refused.length })}
            </p>
          )}
          {undoable.length > 0 && (
            <button
              type="button"
              onClick={() => void undo()}
              disabled={removing}
              className="flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-1 text-xs text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <Undo2 className="h-3.5 w-3.5" />
              {t('undo', { count: undoable.length })}
            </button>
          )}
        </div>
      )}

      {error && <p className="text-[11px] text-red-600 dark:text-red-400">{t('error')}</p>}
    </section>
  );
}
