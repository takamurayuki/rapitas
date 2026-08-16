'use client';
/**
 * UtilizationChartCard
 *
 * Renders one utilization time-series card (per-role or per-CLI-agent daily
 * busy ratio, 0..1) by adapting /agent-metrics/utilization daily points onto
 * the shared WeeklyMetricChart. Contains no fetching — data arrives via props
 * from useMetricsData.
 */
import { Percent } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  WeeklyMetricChart,
  type WeeklyMetricPoint,
  type WeeklyMetricSeries,
} from '@/app/agents/growth/components/WeeklyMetricChart';
import { ROLE_COLORS, CLI_AGENT_COLORS } from './utilization-colors';
import type { UtilizationDailyPoint } from '../_hooks/useMetricsData';

export type { UtilizationDailyPoint };

interface UtilizationChartCardProps {
  title: string;
  daily: UtilizationDailyPoint[];
  /** Which key set of the daily points this card charts. */
  keyKind: 'role' | 'agent';
}

// NOTE: Proper nouns, not translations — same values as CliAgentUsageWidget.
const CLI_AGENT_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini',
};

/**
 * Collect the union of series keys across all days, ordered canonically by the
 * shared color-map insertion order; unknown keys append in first-seen order.
 */
function collectKeys(daily: UtilizationDailyPoint[], keyKind: 'role' | 'agent'): string[] {
  const seen = new Set<string>();
  for (const d of daily) {
    for (const k of Object.keys(keyKind === 'role' ? d.byRole : d.byAgent)) seen.add(k);
  }
  const canonical = Object.keys(keyKind === 'role' ? ROLE_COLORS : CLI_AGENT_COLORS);
  return [
    ...canonical.filter((k) => seen.has(k)),
    ...Array.from(seen).filter((k) => !canonical.includes(k)),
  ];
}

/**
 * One utilization chart card for the agent metrics page.
 *
 * @param props - Card title, daily utilization points, and the key set to chart.
 */
export function UtilizationChartCard({ title, daily, keyKind }: UtilizationChartCardProps) {
  const t = useTranslations('agents');
  const tHome = useTranslations('home');

  const colors = keyKind === 'role' ? ROLE_COLORS : CLI_AGENT_COLORS;
  const labelOf = (key: string): string => {
    // Unknown keys fall back to the raw name — next-intl would render a
    // missing-key placeholder otherwise.
    if (keyKind === 'role') return key in ROLE_COLORS ? tHome(`agentUsage.roles.${key}`) : key;
    if (key in CLI_AGENT_LABELS) return CLI_AGENT_LABELS[key];
    return key === 'other' ? tHome('cliUsage.otherAgent') : key;
  };

  const keys = collectKeys(daily, keyKind);
  const series: WeeklyMetricSeries[] = keys.map((key) => ({
    dataKey: key,
    label: labelOf(key),
    color: colors[key] ?? colors.other,
  }));

  const data: WeeklyMetricPoint[] = daily.map((d) => ({
    weekLabel: d.date.slice(5).replace('-', '/'),
    ...(keyKind === 'role' ? d.byRole : d.byAgent),
  }));

  return (
    <WeeklyMetricChart
      title={title}
      icon={Percent}
      iconBgClass="bg-sky-100 dark:bg-sky-900/40"
      iconColorClass="text-sky-600 dark:text-sky-400"
      valueFormat="percent"
      emptyMessage={t('utilizationEmpty')}
      noDataLabel={t('utilizationNoData')}
      series={series}
      data={data}
    />
  );
}
