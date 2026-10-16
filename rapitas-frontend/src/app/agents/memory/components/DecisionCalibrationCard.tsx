'use client';
// DecisionCalibrationCard

import { useEffect, useState } from 'react';
import { Scale } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('DecisionCalibrationCard');

interface DeciderStats {
  total: number;
  correct: number;
  wrong: number;
  partial: number;
  pending: number;
  precision: number | null;
}

interface DecisionStatsResponse {
  byDecider: Record<string, DeciderStats>;
}

/** Deciders shown as columns, in display order. */
const DECIDER_KEYS = ['user', 'auto'] as const;

/**
 * Shows plan-gate decision calibration: how accurate the human's
 * approvals/rejections are versus the auto-approve policy. This is the
 * human-AI co-evolution readout — it makes "which of us should hold this
 * gate" a measured question instead of a guess.
 */
export function DecisionCalibrationCard() {
  const t = useTranslations('agents.memory.decisionCalibration');
  const [stats, setStats] = useState<DecisionStatsResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/memory/decisions/stats`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setStats(data);
      })
      .catch((err) => logger.error('Failed to fetch decision stats:', err));
    return () => {
      cancelled = true;
    };
  }, []);

  const deciders = DECIDER_KEYS.map((key) => ({
    key,
    stats: stats?.byDecider?.[key] ?? null,
  }));
  const hasAny = deciders.some((d) => (d.stats?.total ?? 0) > 0);

  return (
    <div className="mb-8 p-6 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
      <div className="flex items-center gap-3 mb-1">
        <div className="p-2 bg-zinc-100 dark:bg-zinc-700/50 text-zinc-600 dark:text-zinc-300 rounded-lg">
          <Scale className="w-5 h-5" />
        </div>
        <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">{t('title')}</h3>
      </div>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-5">{t('subtitle')}</p>

      {!hasAny ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400 py-4 text-center">{t('empty')}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {deciders.map(({ key, stats: s }) => (
            <div
              key={key}
              className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/40"
            >
              <div className="text-sm font-semibold text-zinc-600 dark:text-zinc-300 mb-2">
                {t(`decider.${key}`)}
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-semibold text-indigo-600 dark:text-indigo-400 tabular-nums">
                  {s?.precision != null ? `${Math.round(s.precision * 100)}%` : '—'}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {t('precisionLabel')}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                <span>{t('correctCount', { count: s?.correct ?? 0 })}</span>
                <span>{t('wrongCount', { count: s?.wrong ?? 0 })}</span>
                <span>{t('partialCount', { count: s?.partial ?? 0 })}</span>
                <span>{t('pendingCount', { count: s?.pending ?? 0 })}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
