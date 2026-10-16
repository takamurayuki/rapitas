'use client';
/**
 * CliAgentUsageWidget
 *
 * Per-CLI-agent usage view (Claude Code / Codex / Gemini): yen cost, share
 * of spend, executions, tokens — from real recorded executions via
 * /agent-metrics/usage-breakdown. The at-a-glance "which agent is burning
 * the budget" card, inspired by Vibe Meter-style usage apps.
 */
import { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { Spinner } from '@/components/ui/spinner';
import { formatJpy, DEFAULT_USD_JPY_RATE } from './useUsdJpyRate';
import { formatTime } from '@/utils/date';

interface CliAgentUsageEntry {
  agent: string;
  executions: number;
  failedExecutions: number;
  costUsd: number;
  shareOfCost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  llmCalls: number;
  averageExecutionTimeMs: number | null;
}

interface SubscriptionUsage {
  windowHours: number;
  windowLimitUsd: number;
  currentWindow: {
    startedAt: string | null;
    endsAt: string | null;
    usedUsd: number;
    remainingUsd: number;
    usedRatio: number;
  };
  period: {
    coveredUsd: number;
    overageUsd: number;
  };
}

interface UsageBreakdownResponse {
  windowDays: number;
  totalCostUsd: number;
  totalExecutions: number;
  usdJpyRate?: number;
  /** Absent on pre-upgrade backends — treat as empty (no crash). */
  agents?: CliAgentUsageEntry[];
  subscription?: SubscriptionUsage | null;
}

const WINDOW_OPTIONS = [7, 14, 30] as const;

// NOTE: Fixed agent→color mapping (color follows the entity, never its rank).
// Palette validated for light (#fff) and dark (#18181b) surfaces incl. CVD
// separation; 'other' is intentionally neutral.
const AGENT_COLORS: Record<string, string> = {
  'claude-code': '#6366f1',
  codex: '#0d9488',
  gemini: '#d97706',
  other: '#71717a',
};

const AGENT_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini',
};

/**
 * Subscription window gauge: how much of the current rolling window remains,
 * plus the period's covered-vs-overage split (overage is tracked separately).
 */
function SubscriptionGauge({ sub, rate }: { sub: SubscriptionUsage; rate: number }) {
  const t = useTranslations('home');
  const active = sub.currentWindow.startedAt != null;
  const ratio = sub.currentWindow.usedRatio;
  const barColor = ratio >= 0.9 ? 'bg-red-500' : ratio >= 0.75 ? 'bg-amber-500' : 'bg-indigo-500';
  const resetTime = sub.currentWindow.endsAt ? formatTime(sub.currentWindow.endsAt) : null;

  return (
    <div className="rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/50">
      <div className="flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400">
        <span>{t('cliUsage.subGaugeLabel', { hours: sub.windowHours })}</span>
        <span>
          {active && resetTime
            ? t('cliUsage.subResets', { time: resetTime })
            : t('cliUsage.subIdle')}
        </span>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
        <div
          className={`h-full rounded-full ${barColor}`}
          style={{ width: `${Math.min(100, ratio * 100)}%` }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-xs">
        <span className="font-medium text-zinc-800 dark:text-zinc-200">
          {t('cliUsage.subRemaining', {
            remaining: formatJpy(sub.currentWindow.remainingUsd, rate),
            percent: Math.min(999, Math.round(ratio * 100)),
          })}
        </span>
        <span className="text-zinc-500 dark:text-zinc-400">
          {t('cliUsage.subCovered', { amount: formatJpy(sub.period.coveredUsd, rate) })}
          {sub.period.overageUsd > 0 && (
            <span className="ml-2 font-medium text-red-600 dark:text-red-400">
              {t('cliUsage.subOverage', { amount: formatJpy(sub.period.overageUsd, rate) })}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

export default function CliAgentUsageWidget() {
  const t = useTranslations('home');
  const [data, setData] = useState<UsageBreakdownResponse | null>(null);
  const [windowDays, setWindowDays] = useState<number>(14);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`${API_BASE_URL}/agent-metrics/usage-breakdown?days=${windowDays}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as UsageBreakdownResponse | { error: string };
      })
      .then((v) => {
        if (cancelled) return;
        if ('error' in v) setError(v.error);
        else setData(v);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'fetch failed');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [windowDays]);

  const rate = data?.usdJpyRate ?? DEFAULT_USD_JPY_RATE;
  // NOTE: A backend that predates this widget returns no `agents` field —
  // default to [] so the widget degrades to its empty state instead of
  // crashing on `.length` (observed live before the backend restart).
  const agents = data?.agents ?? [];
  const subscription = data?.subscription ?? null;
  const labelOf = (agent: string) => AGENT_LABELS[agent] ?? t('cliUsage.otherAgent');
  const colorOf = (agent: string) => AGENT_COLORS[agent] ?? AGENT_COLORS.other;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-indigo-500" />
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {t('cliUsage.title')}
          </h3>
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {t('cliUsage.windowLabel', { days: windowDays })}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {data && data.totalExecutions > 0 && (
            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {formatJpy(data.totalCostUsd, rate)}
            </span>
          )}
          <div className="flex rounded-md border border-zinc-200 dark:border-zinc-700 overflow-hidden">
            {WINDOW_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => setWindowDays(d)}
                className={`px-2 py-0.5 text-[11px] font-medium ${
                  windowDays === d
                    ? 'bg-indigo-500 text-white'
                    : 'text-zinc-500 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800'
                }`}
              >
                {t('cliUsage.daysButton', { days: d })}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex h-28 items-center justify-center">
          <Spinner size="md" />
        </div>
      ) : error ? (
        <div className="flex h-28 items-center justify-center text-xs text-red-500">{error}</div>
      ) : !data || agents.length === 0 ? (
        <div className="flex h-28 items-center justify-center text-xs text-zinc-500 dark:text-zinc-400">
          {t('cliUsage.noData')}
        </div>
      ) : (
        <div className="space-y-3">
          {subscription && <SubscriptionGauge sub={subscription} rate={rate} />}

          {/* Cost share bar across agents */}
          {data.totalCostUsd > 0 && (
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              {agents
                .filter((a) => a.shareOfCost > 0)
                .map((a) => (
                  <div
                    key={a.agent}
                    style={{ width: `${a.shareOfCost * 100}%`, backgroundColor: colorOf(a.agent) }}
                    title={`${labelOf(a.agent)}: ${(a.shareOfCost * 100).toFixed(0)}%`}
                  />
                ))}
            </div>
          )}

          {/* Per-agent cards */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((a) => (
              <div key={a.agent} className="rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/50">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: colorOf(a.agent) }}
                    />
                    {labelOf(a.agent)}
                  </span>
                  <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                    {(a.shareOfCost * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  {formatJpy(a.costUsd, rate)}
                </div>
                <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                  {t('cliUsage.cardStats', {
                    executions: a.executions,
                    failed: a.failedExecutions,
                    tokens: `${Math.round(a.outputTokens / 1000)}K`,
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
