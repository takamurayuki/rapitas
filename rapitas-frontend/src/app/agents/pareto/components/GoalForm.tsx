'use client';
/**
 * GoalForm
 *
 * Business-goal input for the what-if engine: pick a goal kind (target
 * success rate / throughput gain / cost reduction) and a value, then submit.
 * Owns only the form's local input state; the request lives in
 * useParetoRecommendation.
 */
import { useState, type FormEvent } from 'react';
import { Goal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { GoalKind, ParetoGoal } from '../types';

interface GoalFormProps {
  loading: boolean;
  onSubmit: (goal: ParetoGoal) => void;
}

const GOAL_KINDS: GoalKind[] = ['successRate', 'throughput', 'cost'];
const DEFAULT_VALUES: Record<GoalKind, number> = { successRate: 95, throughput: 20, cost: 20 };
const INPUT_CLASS =
  'w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100';
const LABEL_CLASS = 'block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2';

/**
 * Renders the goal form.
 *
 * @param props - Submit handler and in-flight flag.
 */
export function GoalForm({ loading, onSubmit }: GoalFormProps) {
  const t = useTranslations('agents.pareto.goal');
  const [kind, setKind] = useState<GoalKind>('successRate');
  const [value, setValue] = useState<number>(DEFAULT_VALUES.successRate);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!Number.isFinite(value) || value < 0) return;
    onSubmit({ kind, value });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-6 p-6 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700"
    >
      <div className="flex items-center gap-3 mb-1">
        <Goal className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
        <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">{t('title')}</h3>
      </div>
      <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">{t('hint')}</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
        <div>
          <label htmlFor="pareto-goal-kind" className={LABEL_CLASS}>
            {t('kind')}
          </label>
          <select
            id="pareto-goal-kind"
            value={kind}
            onChange={(e) => {
              const next = e.target.value as GoalKind;
              setKind(next);
              setValue(DEFAULT_VALUES[next]);
            }}
            className={INPUT_CLASS}
          >
            {GOAL_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`kinds.${k}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pareto-goal-value" className={LABEL_CLASS}>
            {t(`valueLabel.${kind}`)}
          </label>
          <input
            id="pareto-goal-value"
            aria-label={t(`valueLabel.${kind}`)}
            type="number"
            min={0}
            max={kind === 'successRate' ? 100 : undefined}
            step={0.5}
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
            className={INPUT_CLASS}
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-600"
        >
          {loading ? t('loading') : t('submit')}
        </button>
      </div>
    </form>
  );
}
