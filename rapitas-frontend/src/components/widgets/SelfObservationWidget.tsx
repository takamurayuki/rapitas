'use client';
/**
 * SelfObservationWidget
 *
 * Compact dashboard card showing how the AI agents have actually behaved
 * over the trailing window: cost spent, cache effectiveness, model mix,
 * error rate. Data comes from /agent-metrics/observation, which aggregates
 * the per-execution metrics already recorded by the orchestrator.
 */
import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, DollarSign, Zap, Loader2 } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';

interface DailyCostPoint {
  date: string;
  costUsd: number;
  executions: number;
}

interface ModelMixEntry {
  modelName: string;
  executions: number;
  costUsd: number;
  shareOfCost: number;
}

interface ObservationSummary {
  windowDays: number;
  totalCostUsd: number;
  totalExecutions: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadInputTokens: number;
  cacheHitRate: number;
  errorRate: number;
  averageExecutionTimeMs: number | null;
  dailyCost: DailyCostPoint[];
  modelMix: ModelMixEntry[];
}

const WINDOW_OPTIONS = [7, 14, 30] as const;

export default function SelfObservationWidget() {
  const [data, setData] = useState<ObservationSummary | null>(null);
  const [windowDays, setWindowDays] = useState<number>(14);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`${API_BASE_URL}/agent-metrics/observation?days=${windowDays}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as ObservationSummary | { error: string };
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

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-indigo-500" />
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">自己観測</h3>
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
            （直近 {windowDays} 日）
          </span>
        </div>
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
              {d}日
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
        </div>
      ) : error ? (
        <div className="flex h-32 items-center justify-center text-xs text-red-500">{error}</div>
      ) : !data ? null : (
        <div className="space-y-4">
          {/* KPI row */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Kpi
              icon={<DollarSign className="h-3.5 w-3.5" />}
              label="支出"
              value={`$${data.totalCostUsd.toFixed(2)}`}
              tone="indigo"
            />
            <Kpi
              icon={<Activity className="h-3.5 w-3.5" />}
              label="実行回数"
              value={String(data.totalExecutions)}
              tone="zinc"
            />
            <Kpi
              icon={<Zap className="h-3.5 w-3.5" />}
              label="キャッシュ命中"
              value={`${(data.cacheHitRate * 100).toFixed(0)}%`}
              tone="emerald"
            />
            <Kpi
              icon={<AlertTriangle className="h-3.5 w-3.5" />}
              label="エラー率"
              value={`${(data.errorRate * 100).toFixed(1)}%`}
              tone={data.errorRate > 0.1 ? 'red' : 'zinc'}
            />
          </div>

          {/* Daily cost spark bars */}
          <div>
            <div className="mb-1 text-[11px] text-zinc-500 dark:text-zinc-400">日別コスト</div>
            <DailyCostBars points={data.dailyCost} />
          </div>

          {/* Model mix */}
          {data.modelMix.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                モデル別シェア
              </div>
              <ModelMixBar entries={data.modelMix} />
              <ul className="mt-1.5 space-y-0.5">
                {data.modelMix.slice(0, 4).map((m) => (
                  <li key={m.modelName} className="flex items-center justify-between text-[11px]">
                    <span className="truncate text-zinc-600 dark:text-zinc-400">{m.modelName}</span>
                    <span className="text-zinc-500">
                      ${m.costUsd.toFixed(2)} ({(m.shareOfCost * 100).toFixed(0)}%)
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface KpiProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: 'indigo' | 'emerald' | 'red' | 'zinc';
}

function Kpi({ icon, label, value, tone }: KpiProps) {
  const toneClass = {
    indigo: 'text-indigo-600 dark:text-indigo-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    red: 'text-red-600 dark:text-red-400',
    zinc: 'text-zinc-700 dark:text-zinc-300',
  }[tone];

  return (
    <div className="rounded-lg bg-zinc-50 px-2.5 py-1.5 dark:bg-zinc-800/50">
      <div className={`flex items-center gap-1 text-[10px] font-medium ${toneClass}`}>
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{value}</div>
    </div>
  );
}

function DailyCostBars({ points }: { points: DailyCostPoint[] }) {
  const max = Math.max(...points.map((p) => p.costUsd), 0.0001);
  return (
    <div className="flex h-12 items-end gap-0.5">
      {points.map((p) => {
        const h = Math.max(2, (p.costUsd / max) * 100);
        return (
          <div
            key={p.date}
            className="flex-1 rounded-t bg-indigo-400 transition-all hover:bg-indigo-500 dark:bg-indigo-500/70 dark:hover:bg-indigo-400"
            style={{ height: `${h}%` }}
            title={`${p.date}: $${p.costUsd.toFixed(4)} (${p.executions} 実行)`}
          />
        );
      })}
    </div>
  );
}

function ModelMixBar({ entries }: { entries: ModelMixEntry[] }) {
  const palette = [
    'bg-indigo-500',
    'bg-emerald-500',
    'bg-amber-500',
    'bg-rose-500',
    'bg-sky-500',
    'bg-zinc-400',
  ];
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
      {entries.map((m, i) => (
        <div
          key={m.modelName}
          className={palette[i % palette.length]}
          style={{ width: `${m.shareOfCost * 100}%` }}
          title={`${m.modelName}: ${(m.shareOfCost * 100).toFixed(0)}%`}
        />
      ))}
    </div>
  );
}
