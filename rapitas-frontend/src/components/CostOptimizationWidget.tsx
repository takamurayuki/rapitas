'use client';

/**
 * CostOptimizationWidget
 *
 * Displays execution cost breakdown by model with optimization suggestions.
 * Uses recharts for visualization.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { DollarSign, Zap, Lightbulb } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { API_BASE_URL } from '@/utils/api';

type ModelBreakdown = {
  model: string;
  executions: number;
  successRate: number;
  totalTokens: number;
  avgTokens: number;
  avgTimeMs: number;
  estimatedCost: number;
};

type CostData = {
  totalCost: number;
  totalTokens: number;
  totalExecutions: number;
  modelBreakdown: ModelBreakdown[];
  suggestions: string[];
};

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#f97316'];

/** Shorten model IDs for display. */
function shortModelName(model: string): string {
  if (model.includes('opus')) return 'Opus';
  if (model.includes('sonnet')) return 'Sonnet';
  if (model.includes('haiku')) return 'Haiku';
  if (model.length > 15) return model.slice(0, 12) + '...';
  return model;
}

export function CostOptimizationWidget() {
  const [data, setData] = useState<CostData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/agent-metrics/cost-optimization`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) setData(json.data);
        else if (json.data) setData(json.data);
      }
    } catch {
      // Non-critical widget
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 animate-pulse">
        <div className="h-5 bg-zinc-200 dark:bg-zinc-700 rounded w-40 mb-3" />
        <div className="h-32 bg-zinc-200 dark:bg-zinc-700 rounded" />
      </div>
    );
  }

  if (!data || data.totalExecutions === 0) return null;

  const chartData = data.modelBreakdown.map((m) => ({
    name: shortModelName(m.model),
    cost: m.estimatedCost,
    successRate: m.successRate,
    executions: m.executions,
  }));

  return (
    <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-emerald-500" />
            コスト最適化
          </h3>
          <div className="flex items-center gap-3 text-xs text-zinc-400">
            <span className="flex items-center gap-1">
              <Zap className="w-3 h-3" />
              {(data.totalTokens / 1000).toFixed(0)}K tokens
            </span>
            <span className="font-medium text-emerald-600 dark:text-emerald-400">
              ${data.totalCost.toFixed(2)}
            </span>
          </div>
        </div>

        {chartData.length > 0 && (
          <div className="h-36 -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} barSize={24}>
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: '#71717a' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#a1a1aa' }}
                  axisLine={false}
                  tickLine={false}
                  width={35}
                  tickFormatter={(v: number) => `$${v}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#18181b',
                    border: '1px solid #3f3f46',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: '#e4e4e7',
                  }}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={((value: number) => [`$${value.toFixed(2)}`, 'コスト']) as any}
                />
                <Bar dataKey="cost" radius={[4, 4, 0, 0]}>
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Model comparison table */}
        <div className="mt-3 space-y-1.5">
          {data.modelBreakdown.map((m, i) => (
            <div
              key={m.model}
              className="flex items-center justify-between text-xs"
            >
              <div className="flex items-center gap-2">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: COLORS[i % COLORS.length] }}
                />
                <span className="text-zinc-600 dark:text-zinc-400">
                  {shortModelName(m.model)}
                </span>
              </div>
              <div className="flex items-center gap-3 text-zinc-500 dark:text-zinc-400">
                <span>{m.executions}回</span>
                <span className={m.successRate >= 80 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600'}>
                  {m.successRate}%
                </span>
                <span className="font-medium">${m.estimatedCost.toFixed(2)}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Suggestions */}
        {data.suggestions.length > 0 && (
          <div className="mt-3 p-2.5 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
            {data.suggestions.map((s, i) => (
              <p key={i} className="text-xs text-amber-700 dark:text-amber-300 flex items-start gap-1.5">
                <Lightbulb className="w-3 h-3 mt-0.5 shrink-0" />
                {s}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
