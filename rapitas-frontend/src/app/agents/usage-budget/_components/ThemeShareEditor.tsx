'use client';
/**
 * ThemeShareEditor
 *
 * Manual per-theme allocation (%) of the monthly budget. The 30-day suggestion
 * only pre-fills the rows — nothing is allocated automatically. Links to the
 * existing theme page for renaming themes.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { formatBudgetAmount } from '@/components/providers/UsageBudgetPromptDialog';
import type {
  SuggestedShare,
  ThemeBudgetUsage,
  ThemeOption,
  ThemeShare,
  UsageBudgetUnit,
} from '../_hooks/useUsageBudget';
import { themeLabel } from './ThemeDailyUsageTable';

interface Row {
  themeId: number;
  percent: string;
}

interface Props {
  /** null until a budget exists — shares need a budget to belong to. */
  unit: UsageBudgetUnit | null;
  shares: ThemeShare[];
  usage: ThemeBudgetUsage[];
  suggestions: SuggestedShare[];
  themes: ThemeOption[];
  onSave: (shares: ThemeShare[]) => Promise<boolean>;
}

/**
 * Render the share editor.
 *
 * @param unit - Budget unit, or null when unconfigured / 予算単位
 * @param shares - Saved shares / 保存済み配分
 * @param usage - This month's per-theme usage and allocation / テーマ別使用量
 * @param suggestions - 30-day suggestion / 提案配分
 * @param themes - Theme choices / テーマ一覧
 * @param onSave - Save handler / 保存処理
 */
export function ThemeShareEditor({ unit, shares, usage, suggestions, themes, onSave }: Props) {
  const t = useTranslations('usageBudget');
  const [rows, setRows] = useState<Row[]>([]);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  useEffect(() => {
    setRows(shares.map((s) => ({ themeId: s.themeId, percent: String(s.sharePercent) })));
  }, [shares]);

  const names = new Map<number, string | null>(themes.map((x) => [x.id, x.name]));
  const usageById = new Map(usage.map((u) => [u.themeId, u]));
  const parsed = rows.map((r) => Number(r.percent));
  const total = parsed.reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0);
  const rowsValid = parsed.every((v) => Number.isFinite(v) && v >= 0 && v <= 100);
  const overflow = total > 100 + 1e-9;
  const usedIds = new Set(rows.map((r) => r.themeId));
  const addable = [{ id: 0, name: t('unclassified') }, ...themes].filter((x) => !usedIds.has(x.id));

  const save = async () => {
    setState('saving');
    const ok = await onSave(
      rows.map((r) => ({ themeId: r.themeId, sharePercent: Number(r.percent) })),
    );
    setState(ok ? 'saved' : 'failed');
  };

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          {t('sharesTitle')}
        </h2>
        <Link
          href="/themes"
          className="text-sm text-indigo-600 hover:underline dark:text-indigo-400"
        >
          {t('manageThemes')}
        </Link>
      </div>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">{t('sharesDescription')}</p>

      {unit === null ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('notConfigured')}</p>
      ) : (
        <>
          <ul className="space-y-2">
            {rows.map((r, i) => {
              const u = usageById.get(r.themeId);
              return (
                <li key={r.themeId} className="flex items-center gap-2 text-sm">
                  <span className="w-48 truncate text-zinc-800 dark:text-zinc-200">
                    {themeLabel(t, r.themeId, names.get(r.themeId) ?? u?.themeName)}
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    aria-label={`${t('sharePercent')} ${r.themeId}`}
                    value={r.percent}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)),
                      )
                    }
                    className="w-24 rounded-lg border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {u?.allocated != null &&
                      `${t('allocated')}: ${formatBudgetAmount(t, u.allocated, unit)}`}
                  </span>
                  <button
                    type="button"
                    aria-label={t('remove')}
                    onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                    className="ml-auto text-zinc-400 hover:text-red-500 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              aria-label={t('selectTheme')}
              value=""
              onChange={(e) => {
                const id = Number(e.target.value);
                setRows((prev) => [...prev, { themeId: id, percent: '0' }]);
              }}
              className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            >
              <option value="">{t('addShare')}</option>
              {addable.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              {t('unallocated', {
                percent: String(Math.max(0, Math.round((100 - total) * 10) / 10)),
              })}
            </span>
          </div>

          {overflow && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{t('shareTotalTooHigh')}</p>
          )}

          <div className="mt-4 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400">
            <p className="mb-1 font-medium">{t('suggestionTitle')}</p>
            {suggestions.length === 0 ? (
              <p>{t('noSuggestion')}</p>
            ) : (
              <>
                <p>
                  {suggestions
                    .map((s) => `${themeLabel(t, s.themeId, s.themeName)} ${s.sharePercent}%`)
                    .join(' / ')}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    setRows(
                      suggestions.map((s) => ({
                        themeId: s.themeId,
                        percent: String(s.sharePercent),
                      })),
                    )
                  }
                  className="mt-2 text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  {t('applySuggestion')}
                </button>
              </>
            )}
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              disabled={overflow || !rowsValid || state === 'saving'}
              onClick={save}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {state === 'saving' ? t('saving') : t('save')}
            </button>
            {state === 'saved' && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400">{t('saved')}</span>
            )}
            {state === 'failed' && (
              <span role="alert" className="text-xs text-red-600 dark:text-red-400">
                {t('saveFailed')}
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
