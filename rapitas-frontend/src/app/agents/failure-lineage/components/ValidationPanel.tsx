'use client';
/**
 * ValidationPanel
 *
 * Shows how well the estimator reproduces known failure chains (golden
 * replay) plus live-edge and DecisionLog cross-check counts. A null match
 * rate means there was nothing to check against and is shown as such.
 */
import { useTranslations } from 'next-intl';
import type { LineageValidation } from '../types';

interface ValidationPanelProps {
  validation: LineageValidation;
}

export function ValidationPanel({ validation }: ValidationPanelProps) {
  const t = useTranslations('agents.failureLineage.validation');
  return (
    <section
      data-testid="validation-panel"
      className="mb-6 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800"
    >
      <h2 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{t('title')}</h2>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">{t('description')}</p>
      {validation.matchRate === null ? (
        <p data-testid="validation-none" className="text-sm text-zinc-500 dark:text-zinc-400">
          {t('noTarget')}
        </p>
      ) : (
        <>
          <p
            data-testid="validation-match-rate"
            className="text-2xl font-bold text-zinc-900 dark:text-zinc-100"
          >
            {t('matchRate', { rate: (validation.matchRate * 100).toFixed(0) })}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div data-testid="validation-matched">
              <dt className="text-xs text-zinc-500 dark:text-zinc-400">{t('matched')}</dt>
              <dd className="font-semibold text-emerald-600 dark:text-emerald-400">
                {validation.matched}
              </dd>
            </div>
            <div data-testid="validation-mismatched">
              <dt className="text-xs text-zinc-500 dark:text-zinc-400">{t('mismatched')}</dt>
              <dd className="font-semibold text-red-600 dark:text-red-400">
                {validation.mismatched}
              </dd>
            </div>
            <div data-testid="validation-unchecked">
              <dt className="text-xs text-zinc-500 dark:text-zinc-400">{t('unchecked')}</dt>
              <dd className="font-semibold text-zinc-700 dark:text-zinc-300">
                {validation.unchecked}
              </dd>
            </div>
            <div data-testid="validation-decision-logs">
              <dt className="text-xs text-zinc-500 dark:text-zinc-400">
                {t('decisionLogMatches')}
              </dt>
              <dd className="font-semibold text-zinc-700 dark:text-zinc-300">
                {validation.decisionLogMatches}
              </dd>
            </div>
          </dl>
          <ul className="mt-3 space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
            {validation.chains.map((c) => (
              <li key={c.chainId}>
                {t('chainLine', {
                  label: c.label,
                  matched: c.matchedEdges,
                  expected: c.expectedEdges,
                })}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
