"use client";
import { useEffect, useState, useMemo } from "react";
import { TrendingDown, Calendar, Target, Zap } from "lucide-react";
import { API_BASE_URL } from "@/utils/api";
import type { Theme } from "@/types";

type BurndownData = {
  period: {
    start: string;
    end: string;
    days: number;
  };
  summary: {
    initialTasks: number;
    totalAdded: number;
    totalCompleted: number;
    currentRemaining: number;
    velocity: number;
  };
  dailyData: {
    date: string;
    remaining: number;
    ideal: number;
    completed: number;
    added: number;
  }[];
};

type BurndownChartProps = {
  themeId?: number;
  projectId?: number;
  days?: number;
  className?: string;
};

export default function BurndownChart({
  themeId,
  projectId,
  days = 14,
  className = "",
}: BurndownChartProps) {
  const [data, setData] = useState<BurndownData | null>(null);
  const [loading, setLoading] = useState(true);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [selectedThemeId, setSelectedThemeId] = useState<number | undefined>(themeId);
  const [selectedDays, setSelectedDays] = useState(days);

  useEffect(() => {
    const fetchThemes = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/themes`);
        if (res.ok) setThemes(await res.json());
      } catch (e) {
        console.error("Failed to fetch themes:", e);
      }
    };
    fetchThemes();
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ days: selectedDays.toString() });
        if (selectedThemeId) params.append("themeId", selectedThemeId.toString());
        if (projectId) params.append("projectId", projectId.toString());

        const res = await fetch(`${API_BASE_URL}/statistics/burndown?${params}`);
        if (res.ok) {
          setData(await res.json());
        }
      } catch (e) {
        console.error("Failed to fetch burndown data:", e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [selectedThemeId, projectId, selectedDays]);

  // チャートの描画パラメータ
  const chartConfig = useMemo(() => {
    if (!data || data.dailyData.length === 0) return null;

    const padding = { top: 20, right: 20, bottom: 40, left: 50 };
    const width = 600;
    const height = 300;
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    const maxValue = Math.max(
      ...data.dailyData.map((d) => Math.max(d.remaining, d.ideal)),
      1
    );

    const xScale = (index: number) =>
      padding.left + (index / (data.dailyData.length - 1)) * chartWidth;
    const yScale = (value: number) =>
      padding.top + chartHeight - (value / maxValue) * chartHeight;

    // パスを生成
    const idealPath = data.dailyData
      .map((d, i) => `${i === 0 ? "M" : "L"} ${xScale(i)} ${yScale(d.ideal)}`)
      .join(" ");

    const actualPath = data.dailyData
      .map((d, i) => `${i === 0 ? "M" : "L"} ${xScale(i)} ${yScale(d.remaining)}`)
      .join(" ");

    // Y軸のグリッド線
    const yGridLines = [];
    const gridCount = 5;
    for (let i = 0; i <= gridCount; i++) {
      const value = Math.round((maxValue / gridCount) * i);
      const y = yScale(value);
      yGridLines.push({ y, value });
    }

    return {
      width,
      height,
      padding,
      chartWidth,
      chartHeight,
      maxValue,
      xScale,
      yScale,
      idealPath,
      actualPath,
      yGridLines,
    };
  }, [data]);

  if (loading) {
    return (
      <div className={`bg-white dark:bg-zinc-900 rounded-2xl p-6 ${className}`}>
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-zinc-200 dark:bg-zinc-700 rounded w-1/3" />
          <div className="h-64 bg-zinc-200 dark:bg-zinc-700 rounded" />
        </div>
      </div>
    );
  }

  if (!data || !chartConfig) {
    return (
      <div className={`bg-white dark:bg-zinc-900 rounded-2xl p-6 ${className}`}>
        <p className="text-zinc-500 dark:text-zinc-400 text-center">データがありません</p>
      </div>
    );
  }

  const { summary, dailyData } = data;

  return (
    <div className={`bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-zinc-200/50 dark:border-zinc-800 overflow-hidden ${className}`}>
      {/* ヘッダー */}
      <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <TrendingDown className="w-5 h-5 text-blue-500" />
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">バーンダウンチャート</h2>
          </div>

          {/* フィルター */}
          <div className="flex items-center gap-2">
            <select
              value={selectedThemeId || ""}
              onChange={(e) => setSelectedThemeId(e.target.value ? parseInt(e.target.value) : undefined)}
              className="px-3 py-1.5 text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg"
            >
              <option value="">すべてのテーマ</option>
              {themes.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.name}
                </option>
              ))}
            </select>
            <select
              value={selectedDays}
              onChange={(e) => setSelectedDays(parseInt(e.target.value))}
              className="px-3 py-1.5 text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg"
            >
              <option value="7">7日間</option>
              <option value="14">14日間</option>
              <option value="30">30日間</option>
            </select>
          </div>
        </div>
      </div>

      {/* サマリーカード */}
      <div className="grid grid-cols-4 gap-3 p-4 border-b border-zinc-100 dark:border-zinc-800">
        <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-3">
          <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 mb-1">
            <Target className="w-3.5 h-3.5" />
            残タスク
          </div>
          <div className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
            {summary.currentRemaining}
          </div>
        </div>
        <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-3">
          <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 mb-1">
            <Zap className="w-3.5 h-3.5" />
            完了
          </div>
          <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
            {summary.totalCompleted}
          </div>
        </div>
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
          <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 mb-1">
            <Calendar className="w-3.5 h-3.5" />
            追加
          </div>
          <div className="text-xl font-bold text-blue-600 dark:text-blue-400">
            {summary.totalAdded}
          </div>
        </div>
        <div className="bg-violet-50 dark:bg-violet-900/20 rounded-lg p-3">
          <div className="flex items-center gap-1.5 text-xs text-violet-600 dark:text-violet-400 mb-1">
            <TrendingDown className="w-3.5 h-3.5" />
            速度
          </div>
          <div className="text-xl font-bold text-violet-600 dark:text-violet-400">
            {summary.velocity}/日
          </div>
        </div>
      </div>

      {/* チャート */}
      <div className="p-4">
        <svg
          viewBox={`0 0 ${chartConfig.width} ${chartConfig.height}`}
          className="w-full h-auto"
        >
          {/* グリッド線 */}
          {chartConfig.yGridLines.map(({ y, value }) => (
            <g key={value}>
              <line
                x1={chartConfig.padding.left}
                y1={y}
                x2={chartConfig.width - chartConfig.padding.right}
                y2={y}
                stroke="currentColor"
                strokeOpacity={0.1}
                strokeDasharray="4"
              />
              <text
                x={chartConfig.padding.left - 8}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                className="text-[10px] fill-zinc-400"
              >
                {value}
              </text>
            </g>
          ))}

          {/* X軸ラベル */}
          {dailyData
            .filter((_, i) => i % Math.ceil(dailyData.length / 7) === 0 || i === dailyData.length - 1)
            .map((d, i, arr) => {
              const originalIndex = dailyData.indexOf(d);
              return (
                <text
                  key={d.date}
                  x={chartConfig.xScale(originalIndex)}
                  y={chartConfig.height - 10}
                  textAnchor="middle"
                  className="text-[10px] fill-zinc-400"
                >
                  {new Date(d.date).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}
                </text>
              );
            })}

          {/* 理想線 */}
          <path
            d={chartConfig.idealPath}
            fill="none"
            stroke="#94a3b8"
            strokeWidth={2}
            strokeDasharray="6 4"
          />

          {/* 実績線 */}
          <path
            d={chartConfig.actualPath}
            fill="none"
            stroke="#3b82f6"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* データポイント */}
          {dailyData.map((d, i) => (
            <circle
              key={d.date}
              cx={chartConfig.xScale(i)}
              cy={chartConfig.yScale(d.remaining)}
              r={4}
              fill="#3b82f6"
              className="hover:r-6 transition-all cursor-pointer"
            >
              <title>
                {new Date(d.date).toLocaleDateString("ja-JP")}: 残り{d.remaining}件
              </title>
            </circle>
          ))}
        </svg>

        {/* 凡例 */}
        <div className="flex items-center justify-center gap-6 mt-4">
          <div className="flex items-center gap-2">
            <div className="w-4 h-0.5 bg-blue-500 rounded" />
            <span className="text-xs text-zinc-500 dark:text-zinc-400">実績</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-0.5 bg-zinc-400 rounded" style={{ borderStyle: "dashed" }} />
            <span className="text-xs text-zinc-500 dark:text-zinc-400">理想</span>
          </div>
        </div>
      </div>
    </div>
  );
}
