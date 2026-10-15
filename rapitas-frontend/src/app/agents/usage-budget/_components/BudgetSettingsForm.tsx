'use client';
/**
 * BudgetSettingsForm
 *
 * Edits the monthly budget: unit (tokens or runs) and the monthly limit.
 * Keeps the typed values when a save fails so nothing is lost.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { UsageBudgetUnit } from '../_hooks/useUsageBudget';

interface Props {
  unit: UsageBudgetUnit | null;
  monthlyLimit: number | null;
  /** Resolves true on success. */
  onSave: (unit: UsageBudgetUnit, monthlyLimit: number) => Promise<boolean>;
}

/**
 * Render the budget form.
 *
 * @param unit - Saved unit, or null when unconfigured / 保存済みの単位
 * @param monthlyLimit - Saved limit, or null / 保存済みの上限
 * @param onSave - Save handler / 保存処理
 */
export function BudgetSettingsForm({ unit, monthlyLimit, onSave }: Props) {
  const t = useTranslations('usageBudget');
  const [unitValue, setUnitValue] = useState<UsageBudgetUnit>(unit ?? 'tokens');
  const [limitValue, setLimitValue] = useState(monthlyLimit ? String(monthlyLimit) : '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  useEffect(() => {
    if (unit) setUnitValue(unit);
    if (monthlyLimit) setLimitValue(String(monthlyLimit));
  }, [unit, monthlyLimit]);

  const valid = /^\d+$/.test(limitValue.trim()) && Number(limitValue) > 0;

  const save = async () => {
    setState('saving');
    const ok = await onSave(unitValue, Number(limitValue));
    setState(ok ? 'saved' : 'failed');
  };

  const inputClass =
    'rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100';

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
      <h2 className="mb-3 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        {t('settingsTitle')}
      </h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm text-zinc-600 dark:text-zinc-400">
          <span className="mb-1 block">{t('unit')}</span>
          <select
            value={unitValue}
            onChange={(e) => setUnitValue(e.target.value as UsageBudgetUnit)}
            className={inputClass}
          >
            <option value="tokens">{t('unitTokens')}</option>
            <option value="executions">{t('unitExecutions')}</option>
          </select>
        </label>
        <label className="text-sm text-zinc-600 dark:text-zinc-400">
          <span className="mb-1 block">{t('monthlyLimit')}</span>
          <input
            type="number"
            aria-label={t('monthlyLimit')}
            min={1}
            step={1}
            value={limitValue}
            onChange={(e) => setLimitValue(e.target.value)}
            className={inputClass}
          />
        </label>
        <button
          type="button"
          disabled={!valid || state === 'saving'}
          onClick={save}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state === 'saving' ? t('saving') : t('save')}
        </button>
      </div>
      {!valid && limitValue !== '' && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{t('limitInvalid')}</p>
      )}
      {state === 'saved' && (
        <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">{t('saved')}</p>
      )}
      {state === 'failed' && (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
          {t('saveFailed')}
        </p>
      )}
    </section>
  );
}
