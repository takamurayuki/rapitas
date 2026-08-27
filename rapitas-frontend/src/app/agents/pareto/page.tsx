'use client';
/**
 * ParetoFrontierPage
 *
 * /agents/pareto — multi-objective efficiency-frontier dashboard. Shows one
 * Pareto curve per workflow type x role (execution time / success rate /
 * cost, each with a 95% CI) and a goal-driven what-if form that recommends
 * a parameter set for a business goal. Orchestrates hooks and child
 * components only; all maths lives in the backend.
 */
import { AlertTriangle, ChartScatter, Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useParetoFrontierData } from './useParetoFrontierData';
import { useParetoRecommendation } from './useParetoRecommendation';
import { ParetoFilters } from './components/ParetoFilters';
import { ParetoScatterChart } from './components/ParetoScatterChart';
import { ParetoPointsTable } from './components/ParetoPointsTable';
import { GoalForm } from './components/GoalForm';
import { RecommendationCard } from './components/RecommendationCard';

/** Skeleton loader shown while the initial frontier fetch is in-flight. */
function PageSkeleton() {
  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-[var(--background)] scrollbar-thin">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-zinc-200 dark:bg-zinc-700 rounded w-64" />
          <div className="h-24 bg-zinc-200 dark:bg-zinc-700 rounded-xl" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-72 bg-zinc-200 dark:bg-zinc-700 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ParetoFrontierPage() {
  const t = useTranslations('agents.pareto');
  const tw = useTranslations('agents.pareto.workflowType');
  const tr = useTranslations('agents.pareto.roles');
  const { frontier, loading, error, filters, setFilters } = useParetoFrontierData();
  const recommendation = useParetoRecommendation(filters);

  if (loading && !frontier) return <PageSkeleton />;

  const segments = frontier?.segments ?? [];
  const minSamples = frontier?.metrics.minReliableSamples ?? 5;

  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-[var(--background)] scrollbar-thin">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400">
              <ChartScatter className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
              {t('pageTitle')}
            </h1>
          </div>
          <p className="text-zinc-500 dark:text-zinc-400">{t('pageSubtitle')}</p>
        </div>

        {frontier && !frontier.metrics.cpuMemoryAvailable && (
          <div
            className="mb-6 p-3 rounded-lg border border-sky-200 bg-sky-50 text-sky-800 text-xs flex items-start gap-2 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-300"
            data-testid="cpu-memory-notice"
          >
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{t('cpuMemoryNotice')}</span>
          </div>
        )}

        <ParetoFilters filters={filters} setFilters={setFilters} />

        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
            <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
          </div>
        )}

        <GoalForm loading={recommendation.loading} onSubmit={recommendation.recommend} />

        {recommendation.error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
            <p className="text-red-600 dark:text-red-400 text-sm">{recommendation.error}</p>
          </div>
        )}

        {recommendation.result && (
          <section className="mb-8" data-testid="recommendation-section">
            <h2 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {t('recommendation.title')}
            </h2>
            <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
              {t('recommendation.correlationNote')}
            </p>
            {recommendation.result.recommendations.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {t('recommendation.noSegments')}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {recommendation.result.recommendations.map((r) => (
                  <RecommendationCard key={`${r.workflowType}:${r.role}`} recommendation={r} />
                ))}
              </div>
            )}
          </section>
        )}

        {!error && segments.length === 0 && (
          <div className="text-center py-16">
            <ChartScatter className="w-16 h-16 text-zinc-300 dark:text-zinc-600 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-zinc-600 dark:text-zinc-400 mb-2">
              {t('empty.title')}
            </h2>
            <p className="text-zinc-500 dark:text-zinc-400">{t('empty.hint')}</p>
          </div>
        )}

        {segments.length > 0 && (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            {segments.map((segment) => (
              <div
                key={`${segment.workflowType}:${segment.role}`}
                className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800"
                data-testid="pareto-segment"
              >
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {t('segment.title', {
                      workflowType: tw(segment.workflowType),
                      // Roles outside the known set (custom modes) fall back to the raw key.
                      role: tr.has(segment.role) ? tr(segment.role) : segment.role,
                    })}
                  </h3>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {t('segment.sampleSize', { count: segment.sampleSize })}
                  </span>
                </div>
                <ParetoScatterChart points={segment.points} baseline={segment.baseline} />
                <div className="mt-3">
                  <ParetoPointsTable
                    points={segment.points}
                    baseline={segment.baseline}
                    minReliableSamples={minSamples}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
