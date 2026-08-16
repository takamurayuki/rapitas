'use client';
/**
 * MissSignaturesClient
 *
 * Review client for detection-miss signature suggestions: shows the derived
 * approval mode (with its basis), verdict counts, and the pending queue with
 * approve/reject actions. Wiring mirrors PromptEvolutionProposals — nothing
 * is applied without a verdict while the mode is manual.
 */
import { useCallback, useEffect, useState } from 'react';
import { Check, X, ScanSearch } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import type { MissSuggestion, MissSummary } from './miss-signatures.types';

const logger = createLogger('MissSignaturesClient');

/** Badge colors per approval mode (dark-mode aware). */
const MODE_BADGE_CLASS: Record<MissSummary['decision']['mode'], string> = {
  manual: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  auto: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
};

export function MissSignaturesClient() {
  const t = useTranslations('agents.missSignatures');
  const [summary, setSummary] = useState<MissSummary | null>(null);
  const [suggestions, setSuggestions] = useState<MissSuggestion[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const reload = useCallback(async () => {
    try {
      const [summaryRes, listRes] = await Promise.all([
        fetch(`${API_BASE_URL}/self-improvement/miss-signatures/summary`),
        fetch(`${API_BASE_URL}/self-improvement/miss-signatures/`),
      ]);
      if (!summaryRes.ok || !listRes.ok)
        throw new Error(`HTTP ${summaryRes.status}/${listRes.status}`);
      const summaryBody = (await summaryRes.json()) as { summary: MissSummary };
      const listBody = (await listRes.json()) as { suggestions: MissSuggestion[] };
      setSummary(summaryBody.summary);
      setSuggestions(listBody.suggestions);
      setLoadFailed(false);
    } catch (err) {
      logger.error('Failed to load miss-signature data:', err);
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const review = async (id: number, approved: boolean) => {
    setBusyId(id);
    try {
      const res = await fetch(`${API_BASE_URL}/self-improvement/miss-signatures/${id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSuggestions((prev) => prev.filter((s) => s.id !== id));
      // Verdicts move the rejection window — refresh the derived mode.
      void reload();
    } catch (err) {
      logger.error('Failed to review suggestion:', err);
      setLoadFailed(true);
    } finally {
      setBusyId(null);
    }
  };

  const countItems: { key: keyof MissSummary['counts']; label: string }[] = summary
    ? [
        { key: 'pendingReview', label: t('counts.pendingReview') },
        { key: 'approved', label: t('counts.approved') },
        { key: 'rejected', label: t('counts.rejected') },
        { key: 'autoApplied', label: t('counts.autoApplied') },
        { key: 'cases', label: t('counts.cases') },
      ]
    : [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="mb-1 flex items-center gap-2 text-xl font-bold text-zinc-900 dark:text-zinc-50">
        <ScanSearch className="h-5 w-5 text-indigo-500" />
        {t('title')}
      </h1>
      <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">{t('subtitle')}</p>

      {loadFailed && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {t('loadFailed')}
        </div>
      )}

      {summary && (
        <div className="mb-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
              {t('mode.label')}
            </span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${MODE_BADGE_CLASS[summary.decision.mode]}`}
            >
              {t(`mode.${summary.decision.mode}`)}
            </span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {t('rejectionRate')}:{' '}
              {summary.decision.rejectionRate === null
                ? t('rejectionRateNone')
                : `${(summary.decision.rejectionRate * 100).toFixed(1)}%`}
            </span>
          </div>
          <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
            {t(`basis.${summary.decision.basis}`)}
          </p>
          <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
            {t('window', {
              days: summary.window.days,
              samples: summary.window.samples,
              rejections: summary.window.rejections,
            })}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {countItems.map(({ key, label }) => (
              <div
                key={key}
                className="rounded-md border border-zinc-200 bg-zinc-50 p-2 text-center dark:border-zinc-700 dark:bg-zinc-900/40"
              >
                <div className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
                  {summary.counts[key]}
                </div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <h2 className="mb-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
        {t('signaturePending')}
        <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
          {suggestions.length}
        </span>
      </h2>

      {suggestions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-600 dark:text-zinc-400">
          {t('empty')}
        </p>
      ) : (
        <div className="space-y-3">
          {suggestions.map((s) => (
            <div
              key={s.id}
              className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800"
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <code className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  {s.signature}
                </code>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={busyId === s.id}
                    onClick={() => review(s.id, true)}
                    className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    <Check className="h-3.5 w-3.5" />
                    {t('approve')}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === s.id}
                    onClick={() => review(s.id, false)}
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    <X className="h-3.5 w-3.5" />
                    {t('reject')}
                  </button>
                </div>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {t('explanationLabel')}: {s.explanation}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
