'use client';
/**
 * ClassificationRulesEditor
 *
 * Edits the aggregation-only classification rules: a theme-less task whose
 * title contains the keyword is counted under the chosen theme. List order is
 * the priority (top wins). Tasks themselves are never modified.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { MoveUp, Trash2 } from 'lucide-react';
import type { ClassificationRule, ThemeOption } from '../_hooks/useUsageBudget';

interface Row {
  keyword: string;
  themeId: number;
  enabled: boolean;
}

interface Props {
  rules: ClassificationRule[];
  themes: ThemeOption[];
  onSave: (rules: ClassificationRule[]) => Promise<boolean>;
}

/**
 * Render the rule editor.
 *
 * @param rules - Saved rules / 保存済みルール
 * @param themes - Theme choices / テーマ一覧
 * @param onSave - Save handler (full replace) / 保存処理（全置換）
 */
export function ClassificationRulesEditor({ rules, themes, onSave }: Props) {
  const t = useTranslations('usageBudget');
  const [rows, setRows] = useState<Row[]>([]);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  useEffect(() => {
    setRows(
      [...rules]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((r) => ({ keyword: r.keyword, themeId: r.themeId, enabled: r.enabled })),
    );
  }, [rules]);

  const valid = rows.every((r) => r.keyword.trim().length > 0 && r.themeId > 0);
  const update = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = async () => {
    setState('saving');
    const ok = await onSave(
      rows.map((r, i) => ({
        keyword: r.keyword.trim(),
        themeId: r.themeId,
        enabled: r.enabled,
        sortOrder: i,
      })),
    );
    setState(ok ? 'saved' : 'failed');
  };

  const inputClass =
    'rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100';

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
      <h2 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        {t('rulesTitle')}
      </h2>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">{t('rulesDescription')}</p>

      {rows.length === 0 && (
        <p className="mb-2 text-sm text-zinc-500 dark:text-zinc-400">{t('noRules')}</p>
      )}
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
            <input
              aria-label={`${t('keyword')} ${i + 1}`}
              value={r.keyword}
              onChange={(e) => update(i, { keyword: e.target.value })}
              className={`${inputClass} w-48`}
            />
            <select
              aria-label={`${t('targetTheme')} ${i + 1}`}
              value={r.themeId || ''}
              onChange={(e) => update(i, { themeId: Number(e.target.value) })}
              className={inputClass}
            >
              <option value="">{t('selectTheme')}</option>
              {themes.map((th) => (
                <option key={th.id} value={th.id}>
                  {th.name}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-zinc-600 dark:text-zinc-400">
              <input
                type="checkbox"
                aria-label={`${t('enabled')} ${i + 1}`}
                checked={r.enabled}
                onChange={(e) => update(i, { enabled: e.target.checked })}
              />
              {t('enabled')}
            </label>
            <button
              type="button"
              aria-label={`${t('moveUp')} ${i + 1}`}
              disabled={i === 0}
              onClick={() =>
                setRows((prev) => {
                  const next = [...prev];
                  [next[i - 1], next[i]] = [next[i], next[i - 1]];
                  return next;
                })
              }
              className="text-zinc-400 hover:text-zinc-700 disabled:opacity-30 dark:hover:text-zinc-200"
            >
              <MoveUp className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label={`${t('remove')} ${i + 1}`}
              onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
              className="text-zinc-400 hover:text-red-500 dark:hover:text-red-400"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>

      {!valid && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{t('ruleInvalid')}</p>}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setRows((prev) => [...prev, { keyword: '', themeId: 0, enabled: true }])}
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          {t('addRule')}
        </button>
        <button
          type="button"
          disabled={!valid || state === 'saving'}
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
    </section>
  );
}
