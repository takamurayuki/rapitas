'use client';
// MetricsOverviewCards
import { Activity, Zap, Users, CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { MetricsOverview } from '../_hooks/useMetricsData';

interface MetricsOverviewCardsProps {
  overview: MetricsOverview;
}

/**
 * Renders four gradient summary cards for the metrics overview section.
 *
 * @param overview - Aggregated metrics overview data / 集計メトリクス概要データ
 */
export function MetricsOverviewCards({ overview }: MetricsOverviewCardsProps) {
  const t = useTranslations('agents');

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      <div className="bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-blue-100 text-sm">{t('totalExecutions')}</p>
            <p className="text-2xl font-bold">{overview.totalExecutions.toLocaleString()}</p>
          </div>
          <Activity className="w-8 h-8 text-blue-200" />
        </div>
      </div>

      <div className="bg-gradient-to-br from-green-500 to-green-600 text-white rounded-xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-green-100 text-sm">{t('successRate')}</p>
            <p className="text-2xl font-bold">{overview.overallSuccessRate.toFixed(1)}%</p>
          </div>
          <CheckCircle2 className="w-8 h-8 text-green-200" />
        </div>
      </div>

      <div className="bg-gradient-to-br from-purple-500 to-purple-600 text-white rounded-xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-purple-100 text-sm">{t('totalTokenUsage')}</p>
            <p className="text-2xl font-bold">{(overview.totalTokensUsed / 1000).toFixed(0)}K</p>
          </div>
          <Zap className="w-8 h-8 text-purple-200" />
        </div>
      </div>

      <div className="bg-gradient-to-br from-orange-500 to-orange-600 text-white rounded-xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-orange-100 text-sm">{t('activeAgents')}</p>
            <p className="text-2xl font-bold">
              {overview.activeAgents} / {overview.totalAgents}
            </p>
          </div>
          <Users className="w-8 h-8 text-orange-200" />
        </div>
      </div>
    </div>
  );
}
