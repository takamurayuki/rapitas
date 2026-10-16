'use client';
/**
 * ParetoFilters
 *
 * Window / complexity-band / role selectors for the efficiency-frontier
 * dashboard. Pure presentational; state lives in useParetoFrontierData.
 */
import { Filter } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ComplexityFilter, ParetoQueryFilters } from '../types';
import { ROLE_OPTIONS, WINDOW_DAY_OPTIONS } from '../pareto.utils';

interface ParetoFiltersProps {
  filters: ParetoQueryFilters;
  setFilters: (updater: (prev: ParetoQueryFilters) => ParetoQueryFilters) => void;
}

const SELECT_CLASS =
  'w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100';
const LABEL_CLASS = 'block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2';
const COMPLEXITY_OPTIONS: ComplexityFilter[] = ['all', 'low', 'medium', 'high'];

/**
 * Renders the filter bar.
 *
 * @param props - Current filter state and setter.
 */
export function ParetoFilters({ filters, setFilters }: ParetoFiltersProps) {
  const t = useTranslations('agents.pareto');

  return (
    <div className="mb-6 p-6 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700">
      <div className="flex items-center gap-3 mb-4">
        <Filter className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
        <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">{t('filters.title')}</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label htmlFor="pareto-days" className={LABEL_CLASS}>
            {t('filters.windowDays')}
          </label>
          <select
            id="pareto-days"
            value={filters.days}
            onChange={(e) => {
              const days = Number(e.target.value);
              setFilters((prev) => ({ ...prev, days }));
            }}
            className={SELECT_CLASS}
          >
            {WINDOW_DAY_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {t('filters.days', { days: d })}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pareto-band" className={LABEL_CLASS}>
            {t('filters.complexityBand')}
          </label>
          <select
            id="pareto-band"
            value={filters.complexityBand}
            onChange={(e) => {
              const complexityBand = e.target.value as ComplexityFilter;
              setFilters((prev) => ({ ...prev, complexityBand }));
            }}
            className={SELECT_CLASS}
          >
            {COMPLEXITY_OPTIONS.map((band) => (
              <option key={band} value={band}>
                {t(`filters.band.${band}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pareto-role" className={LABEL_CLASS}>
            {t('filters.role')}
          </label>
          <select
            id="pareto-role"
            value={filters.role}
            onChange={(e) => {
              const role = e.target.value;
              setFilters((prev) => ({ ...prev, role }));
            }}
            className={SELECT_CLASS}
          >
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>
                {t(`roles.${role}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
