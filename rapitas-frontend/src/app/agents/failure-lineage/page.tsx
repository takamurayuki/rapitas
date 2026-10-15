'use client';
/**
 * FailureLineagePage
 *
 * /agents/failure-lineage — estimated failure genealogy built from
 * ERROR/WARN execution logs. Always states that relations are estimates,
 * shows per-edge confidence, highlights root-cause candidates with the
 * estimated downstream reduction, and shows the known-chain validation.
 * Orchestrates hooks and child components only.
 */
import { useMemo, useState } from 'react';
import { AlertTriangle, GitGraph, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Pagination from '@/components/ui/pagination/Pagination';
import { useFailureLineage } from './useFailureLineage';
import { flattenLineage, HOURS_OPTIONS } from './failure-lineage.utils';
import { EstimateBanner } from './components/EstimateBanner';
import { LineageTreeList } from './components/LineageTreeList';
import { LineageGraph } from './components/LineageGraph';
import { ValidationPanel } from './components/ValidationPanel';

export default function FailureLineagePage() {
  const t = useTranslations('agents.failureLineage');
  const { data, loading, error, hours, setHours, refetch } = useFailureLineage();
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  const rows = useMemo(() => (data ? flattenLineage(data) : []), [data]);
  const candidateRows = useMemo(() => rows.filter((r) => r.reducedCount !== null), [rows]);
  const totalPages = Math.max(1, Math.ceil(rows.length / itemsPerPage));
  const page = Math.min(currentPage, totalPages);
  const pageRows = rows.slice((page - 1) * itemsPerPage, page * itemsPerPage);

  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-[var(--background)] scrollbar-thin">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-lg bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400">
                <GitGraph className="w-6 h-6" />
              </div>
              <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                {t('pageTitle')}
              </h1>
            </div>
            <p className="text-zinc-500 dark:text-zinc-400">{t('pageSubtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              aria-label={t('windowLabel')}
              value={hours}
              onChange={(e) => {
                setHours(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-800 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            >
              {HOURS_OPTIONS.map((h) => (
                <option key={h} value={h}>
                  {t('hoursOption', { hours: h })}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void refetch()}
              disabled={loading}
              className="flex items-center gap-1 rounded-lg border border-zinc-300 px-3 py-1 text-sm text-zinc-700 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              {t('refresh')}
            </button>
          </div>
        </div>

        <EstimateBanner />

        {loading && !data && (
          <p data-testid="lineage-loading" className="text-sm text-zinc-500 dark:text-zinc-400">
            {t('loading')}
          </p>
        )}

        {error && (
          <div
            data-testid="lineage-error"
            className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-3"
          >
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
            <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
          </div>
        )}

        {data && (
          <>
            {data.truncated && (
              <p
                data-testid="lineage-truncated"
                className="mb-4 text-xs text-amber-700 dark:text-amber-300"
              >
                {t('truncated')}
              </p>
            )}

            <ValidationPanel validation={data.validation} />

            {data.nodes.length === 0 ? (
              <div data-testid="lineage-empty" className="text-center py-16">
                <GitGraph className="w-16 h-16 text-zinc-300 dark:text-zinc-600 mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-zinc-600 dark:text-zinc-400 mb-2">
                  {t('empty.title')}
                </h2>
                <p className="text-zinc-500 dark:text-zinc-400">{t('empty.hint')}</p>
              </div>
            ) : (
              <>
                <section className="mb-6" data-testid="candidate-section">
                  <h2 className="mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                    {t('candidates.title')}
                  </h2>
                  {candidateRows.length === 0 ? (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      {t('candidates.none')}
                    </p>
                  ) : (
                    <>
                      <LineageTreeList rows={candidateRows} />
                      <div className="mt-4">
                        <LineageGraph rows={candidateRows} />
                      </div>
                    </>
                  )}
                </section>

                <section data-testid="all-events-section">
                  <h2 className="mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                    {t('allEvents.title', { count: rows.length })}
                  </h2>
                  <LineageTreeList rows={pageRows} />
                  <Pagination
                    currentPage={page}
                    totalPages={totalPages}
                    itemsPerPage={itemsPerPage}
                    onPageChange={setCurrentPage}
                    onItemsPerPageChange={(n) => {
                      setItemsPerPage(n);
                      setCurrentPage(1);
                    }}
                  />
                </section>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
