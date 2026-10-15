/**
 * DashboardPage
 *
 * Learning dashboard: KPI strip, suggested next tasks (primary zone), study
 * activity + upcoming exams (secondary), and analytics widgets (tertiary).
 * Data fetching lives in useDashboardData; each zone is an _components module.
 */
'use client';
import { useTranslations } from 'next-intl';
import BurnupChart from '@/components/widgets/burnup-chart';
import { SuggestedTasksWidget } from '@/feature/intelligence/components/SuggestedTasksWidget';
import { ProductivityHeatmap } from '@/feature/intelligence/components/ProductivityHeatmap';
import { DashboardKpiStrip } from './_components/kpi-strip';
import { StudyActivityChart } from './_components/study-activity-chart';
import { UpcomingExamsCard } from './_components/upcoming-exams-card';
import { useDashboardData } from './_components/use-dashboard-data';

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const { overview, dailyStudy, streakInfo, loading } = useDashboardData();

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl p-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 w-48 rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-16 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
            ))}
          </div>
          <div className="h-64 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      {/* Page header — text only; the previous oversized accent icon was
          redundant chrome (design-language tells #1/#10). */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{t('title')}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('subtitle')}</p>
      </div>

      <DashboardKpiStrip overview={overview} streakInfo={streakInfo} />

      {/* Primary zone — the actionable "what to do next" list leads the page
          (task-first hierarchy; fixes the "equally loud widgets" tell #6). */}
      <div className="mt-6">
        <SuggestedTasksWidget />
      </div>

      {/* Secondary — recent study activity and exam deadlines. */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <StudyActivityChart dailyStudy={dailyStudy} />
        <UpcomingExamsCard upcomingExams={overview?.upcomingExams ?? []} />
      </div>

      {/* Tertiary — analytics, quieter and below the fold. */}
      <div className="mt-6">
        <ProductivityHeatmap />
      </div>
      <div className="mt-6">
        <BurnupChart days={14} />
      </div>
    </div>
  );
}
