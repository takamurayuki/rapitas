'use client';
import { useEffect, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Loader2,
  Cpu,
  Cloud,
  MessageSquare,
} from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';

interface UsageInfo {
  provider: string;
  plan: string;
  tokensUsed: number;
  estimatedCost: number;
  executionCount: number;
  avgExecutionTimeSec: number;
  period: string;
  periodStart: string;
  periodEnd: string;
  dataSource: 'actual' | 'estimated';
}

const PROVIDER_CONFIG: Record<
  string,
  { label: string; icon: typeof Cloud; color: string; bg: string }
> = {
  claude: {
    label: 'Claude',
    icon: Cloud,
    color: 'text-orange-600 dark:text-orange-400',
    bg: 'bg-orange-500',
  },
  chatgpt: {
    label: 'OpenAI',
    icon: Cloud,
    color: 'text-green-600 dark:text-green-400',
    bg: 'bg-green-500',
  },
  gemini: {
    label: 'Gemini',
    icon: Cloud,
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-500',
  },
  local: {
    label: 'ローカルLLM',
    icon: Cpu,
    color: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-500',
  },
  copilot: {
    label: 'コパイロット',
    icon: MessageSquare,
    color: 'text-indigo-600 dark:text-indigo-400',
    bg: 'bg-indigo-500',
  },
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function UsageRateLimitGraph() {
  const [data, setData] = useState<UsageInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/rate-limits`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { usageData: UsageInfo[] };
        setData(json.usageData ?? []);
      } catch {
        setError('使用状況の取得に失敗しました');
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  if (!isLoading && data.length === 0 && !error) return null;

  const totalCost = data.reduce((s, d) => s + d.estimatedCost, 0);
  const totalTokens = data.reduce((s, d) => s + d.tokensUsed, 0);
  const totalExecutions = data.reduce((s, d) => s + d.executionCount, 0);

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="w-5 h-5 text-zinc-400" />
            <div>
              <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
                今月の使用状況
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {data[0]?.period ?? ''} の実績データ
              </p>
            </div>
          </div>
          {!isLoading && (
            <div className="flex items-center gap-4 text-xs">
              <span className="text-zinc-500">{totalExecutions}回実行</span>
              <span className="text-zinc-500">
                {formatTokens(totalTokens)} tokens
              </span>
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                ${totalCost.toFixed(3)}
              </span>
            </div>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
        </div>
      ) : error ? (
        <div className="p-6 flex items-center gap-2 text-red-600 dark:text-red-400 text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      ) : (
        <div className="p-6 space-y-3">
          {data.map((item) => {
            const cfg = PROVIDER_CONFIG[item.provider] ?? {
              label: item.provider,
              icon: Cloud,
              color: 'text-zinc-600',
              bg: 'bg-zinc-500',
            };
            const Icon = cfg.icon;
            const maxTokens = Math.max(...data.map((d) => d.tokensUsed), 1);
            const barWidth = Math.max((item.tokensUsed / maxTokens) * 100, 2);

            return (
              <div key={item.provider} className="flex items-center gap-3">
                <div className="w-24 flex items-center gap-1.5 shrink-0">
                  <Icon className={`h-3.5 w-3.5 ${cfg.color}`} />
                  <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate">
                    {cfg.label}
                  </span>
                </div>
                <div className="flex-1 h-5 bg-zinc-100 dark:bg-zinc-800 rounded overflow-hidden relative">
                  <div
                    className={`h-full ${cfg.bg} transition-all duration-500 rounded`}
                    style={{ width: `${barWidth}%` }}
                  />
                  <span className="absolute inset-0 flex items-center px-2 text-[10px] font-medium text-zinc-600 dark:text-zinc-400">
                    {item.tokensUsed > 0
                      ? formatTokens(item.tokensUsed)
                      : `${item.executionCount}回`}
                  </span>
                </div>
                <div className="w-20 text-right shrink-0">
                  <span className="text-[10px] text-zinc-500">
                    {item.estimatedCost > 0
                      ? `$${item.estimatedCost.toFixed(3)}`
                      : 'Free'}
                  </span>
                  {item.dataSource === 'estimated' && (
                    <span
                      className="ml-1 text-[8px] text-amber-500"
                      title="実行時間から推定"
                    >
                      ≈
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
