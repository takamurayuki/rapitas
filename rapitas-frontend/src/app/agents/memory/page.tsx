'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  BarChart,
  Bar,
} from 'recharts';
import {
  Brain,
  TrendingUp,
  Database,
  Clock,
  Zap,
  Target,
  Activity,
  AlertTriangle,
  Network,
  Sparkles,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('AgentMemoryPage');

// --- Types ---
interface GrowthTimelineEntry {
  date: string;
  knowledgeNodes: number;
  knowledgeEdges: number;
  learningPatterns: number;
  experimentsCompleted: number;
  successRate: number;
  avgConfidence: number;
  promptImprovements: number;
}

interface GrowthTimeline {
  timeline: GrowthTimelineEntry[];
  period: '7d' | '30d' | 'all';
  totalDays: number;
}

interface MemoryOverview {
  totalMemorySize: {
    nodes: number;
    patterns: number;
    episodes: number;
    experiments: number;
  };
  growthRate: {
    weekly: number;
    monthly: number;
  };
  currentSuccessRate: number;
  memoryStrength: {
    score: number;
    level: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  };
  recentHighlights: {
    latestPatterns: Array<{
      id: number;
      description: string;
      confidence: number;
      createdAt: string;
    }>;
    latestNodes: Array<{
      id: number;
      label: string;
      nodeType: string;
      weight: number;
      createdAt: string;
    }>;
  };
  knowledgeDistribution: Array<{
    category: string;
    count: number;
    percentage: number;
  }>;
}

// --- Constants ---
const PIE_COLORS = [
  '#6366f1',
  '#8b5cf6',
  '#06b6d4',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
];

const NODE_TYPE_LABELS: Record<string, string> = {
  concept: 'コンセプト',
  problem: '問題',
  solution: '解決策',
  technology: 'テクノロジー',
  pattern: 'パターン',
};

const LEVEL_CONFIG: Record<
  string,
  {
    color: string;
    bg: string;
    barColor: string;
    gradient: string;
  }
> = {
  expert: {
    color: 'text-purple-600 dark:text-purple-400',
    bg: 'bg-purple-100 dark:bg-purple-900/30',
    barColor: 'bg-purple-500',
    gradient: 'from-purple-500 to-indigo-500',
  },
  advanced: {
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-100 dark:bg-blue-900/30',
    barColor: 'bg-blue-500',
    gradient: 'from-blue-500 to-cyan-500',
  },
  intermediate: {
    color: 'text-green-600 dark:text-green-400',
    bg: 'bg-green-100 dark:bg-green-900/30',
    barColor: 'bg-green-500',
    gradient: 'from-green-500 to-emerald-500',
  },
  beginner: {
    color: 'text-yellow-600 dark:text-yellow-400',
    bg: 'bg-yellow-100 dark:bg-yellow-900/30',
    barColor: 'bg-yellow-500',
    gradient: 'from-yellow-500 to-orange-500',
  },
};

const LEVEL_LABELS: Record<string, string> = {
  expert: 'エキスパート',
  advanced: 'アドバンスド',
  intermediate: '中級',
  beginner: 'ビギナー',
};

export default function AgentMemoryPage() {
  const tc = useTranslations('common');

  const [memoryOverview, setMemoryOverview] = useState<MemoryOverview | null>(
    null,
  );
  const [growthTimeline, setGrowthTimeline] = useState<GrowthTimeline | null>(
    null,
  );
  const [selectedPeriod, setSelectedPeriod] = useState<'7d' | '30d' | 'all'>(
    '30d',
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMemoryData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [overviewRes, timelineRes] = await Promise.all([
        fetch(`${API_BASE_URL}/learning/memory-overview`),
        fetch(
          `${API_BASE_URL}/learning/growth-timeline?period=${selectedPeriod}`,
        ),
      ]);
      if (overviewRes.ok) setMemoryOverview(await overviewRes.json());
      if (timelineRes.ok) setGrowthTimeline(await timelineRes.json());
      if (!overviewRes.ok && !timelineRes.ok) setError(tc('errorOccurred'));
    } catch (err) {
      logger.error('Failed to fetch memory data:', err);
      setError(tc('errorOccurred'));
    } finally {
      setLoading(false);
    }
  }, [selectedPeriod, tc]);

  useEffect(() => {
    fetchMemoryData();
  }, [fetchMemoryData]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('ja-JP', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatChartDate = (dateString: string) => {
    const d = new Date(dateString);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  if (loading) {
    return (
      <div className="h-[calc(100vh-5rem)] overflow-auto bg-[var(--background)] scrollbar-thin">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="animate-pulse space-y-6">
            <div className="h-8 bg-zinc-200 dark:bg-zinc-700 rounded w-64" />
            <div className="h-40 bg-zinc-200 dark:bg-zinc-700 rounded-xl" />
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-32 bg-zinc-200 dark:bg-zinc-700 rounded-xl"
                />
              ))}
            </div>
            <div className="h-80 bg-zinc-200 dark:bg-zinc-700 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  const levelCfg = memoryOverview
    ? (LEVEL_CONFIG[memoryOverview.memoryStrength.level] ??
      LEVEL_CONFIG.beginner)
    : LEVEL_CONFIG.beginner;

  const totalMemory = memoryOverview
    ? memoryOverview.totalMemorySize.nodes +
      memoryOverview.totalMemorySize.patterns +
      memoryOverview.totalMemorySize.episodes
    : 0;

  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-[var(--background)] scrollbar-thin">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-lg">
              <Brain className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
              エージェントの記憶
            </h1>
          </div>
          <p className="text-zinc-500 dark:text-zinc-400">
            AIエージェントが蓄積した知識と学習パターンの成長を可視化します
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
            <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
          </div>
        )}

        {memoryOverview && (
          <>
            {/* Memory Strength Indicator - Hero Section */}
            <div className="mb-8 p-6 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm dark:shadow-2xl dark:shadow-black/50">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-xl ${levelCfg.bg}`}>
                    <Brain className={`w-8 h-8 ${levelCfg.color}`} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
                      記憶強度
                    </h2>
                    <span className={`text-sm font-semibold ${levelCfg.color}`}>
                      {LEVEL_LABELS[memoryOverview.memoryStrength.level] ??
                        memoryOverview.memoryStrength.level}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-4xl font-bold text-zinc-900 dark:text-zinc-100">
                    {memoryOverview.memoryStrength.score}
                  </div>
                  <div className="text-sm text-zinc-500 dark:text-zinc-400">
                    / 100
                  </div>
                </div>
              </div>

              {/* Animated Progress Bar */}
              <div className="w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-3 overflow-hidden">
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${levelCfg.gradient}`}
                  style={{
                    width: `${memoryOverview.memoryStrength.score}%`,
                    transition: 'width 1.5s cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                />
              </div>
              <div className="flex justify-between mt-2 text-xs text-zinc-400 dark:text-zinc-500">
                <span>ビギナー</span>
                <span>中級</span>
                <span>アドバンスド</span>
                <span>エキスパート</span>
              </div>
            </div>

            {/* Overview Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              {/* Total Memories */}
              <div className="bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-xl p-6 shadow-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-blue-100 text-sm">記憶総量</p>
                    <p className="text-2xl font-bold">
                      {totalMemory.toLocaleString()}
                    </p>
                  </div>
                  <Database className="w-8 h-8 text-blue-200" />
                </div>
                <GrowthBadge
                  value={memoryOverview.growthRate.weekly}
                  label="先週比"
                />
              </div>

              {/* Knowledge Nodes */}
              <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 text-white rounded-xl p-6 shadow-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-emerald-100 text-sm">ナレッジノード</p>
                    <p className="text-2xl font-bold">
                      {memoryOverview.totalMemorySize.nodes.toLocaleString()}
                    </p>
                  </div>
                  <Network className="w-8 h-8 text-emerald-200" />
                </div>
                <p className="mt-3 text-sm text-emerald-100">
                  パターン: {memoryOverview.totalMemorySize.patterns}
                </p>
              </div>

              {/* Success Rate */}
              <div className="bg-gradient-to-br from-purple-500 to-purple-600 text-white rounded-xl p-6 shadow-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-purple-100 text-sm">成功率</p>
                    <p className="text-2xl font-bold">
                      {(memoryOverview.currentSuccessRate * 100).toFixed(1)}%
                    </p>
                  </div>
                  <Target className="w-8 h-8 text-purple-200" />
                </div>
                <p className="mt-3 text-sm text-purple-100">
                  実験数: {memoryOverview.totalMemorySize.experiments}
                </p>
              </div>

              {/* Episodes */}
              <div className="bg-gradient-to-br from-amber-500 to-amber-600 text-white rounded-xl p-6 shadow-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-amber-100 text-sm">エピソード記憶</p>
                    <p className="text-2xl font-bold">
                      {memoryOverview.totalMemorySize.episodes.toLocaleString()}
                    </p>
                  </div>
                  <Sparkles className="w-8 h-8 text-amber-200" />
                </div>
                <GrowthBadge
                  value={memoryOverview.growthRate.monthly}
                  label="先月比"
                />
              </div>
            </div>
          </>
        )}

        {/* Growth Trend Chart */}
        <div className="mb-8 p-6 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm dark:shadow-2xl dark:shadow-black/50">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-lg">
                <Activity className="w-5 h-5" />
              </div>
              <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
                知識の成長トレンド
              </h3>
            </div>
            <div className="flex gap-2">
              {(['7d', '30d', 'all'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setSelectedPeriod(p)}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    selectedPeriod === p
                      ? 'bg-indigo-600 text-white'
                      : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600'
                  }`}
                >
                  {p === '7d' ? '7日間' : p === '30d' ? '30日間' : '全期間'}
                </button>
              ))}
            </div>
          </div>

          {growthTimeline && growthTimeline.timeline.length > 0 ? (
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={growthTimeline.timeline}>
                <defs>
                  <linearGradient id="gradNodes" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradPatterns" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient
                    id="gradExperiments"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  className="stroke-zinc-200 dark:stroke-zinc-700"
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  className="fill-zinc-500"
                  tickFormatter={formatChartDate}
                />
                <YAxis tick={{ fontSize: 11 }} className="fill-zinc-500" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--color-zinc-800, #27272a)',
                    border: '1px solid var(--color-zinc-700, #3f3f46)',
                    borderRadius: '8px',
                    color: '#f4f4f5',
                    fontSize: '13px',
                  }}
                  labelFormatter={(v) => `${v}`}
                  formatter={
                    ((value: unknown, name: unknown) => {
                      const labels: Record<string, string> = {
                        knowledgeNodes: 'ナレッジノード',
                        learningPatterns: '学習パターン',
                        experimentsCompleted: '完了実験',
                      };
                      return [value, labels[name as string] ?? name];
                    }) as never
                  }
                />
                <Legend
                  formatter={(value) => {
                    const labels: Record<string, string> = {
                      knowledgeNodes: 'ナレッジノード',
                      learningPatterns: '学習パターン',
                      experimentsCompleted: '完了実験',
                    };
                    return labels[value] ?? value;
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="knowledgeNodes"
                  stroke="#3b82f6"
                  fill="url(#gradNodes)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="learningPatterns"
                  stroke="#10b981"
                  fill="url(#gradPatterns)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="experimentsCompleted"
                  stroke="#8b5cf6"
                  fill="url(#gradExperiments)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart message="成長データがまだありません" />
          )}
        </div>

        {/* Two Column: Success Rate + Knowledge Distribution */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Success Rate Trend */}
          <div className="p-6 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm dark:shadow-2xl dark:shadow-black/50">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-lg">
                <Zap className="w-5 h-5" />
              </div>
              <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
                成功率の推移
              </h3>
            </div>

            {growthTimeline && growthTimeline.timeline.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={growthTimeline.timeline}>
                  <defs>
                    <linearGradient
                      id="gradSuccess"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-zinc-200 dark:stroke-zinc-700"
                  />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    className="fill-zinc-500"
                    tickFormatter={formatChartDate}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    className="fill-zinc-500"
                    domain={[0, 1]}
                    tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--color-zinc-800, #27272a)',
                      border: '1px solid var(--color-zinc-700, #3f3f46)',
                      borderRadius: '8px',
                      color: '#f4f4f5',
                      fontSize: '13px',
                    }}
                    formatter={
                      ((v: unknown) => [
                        `${(Number(v) * 100).toFixed(1)}%`,
                        '成功率',
                      ]) as never
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="successRate"
                    stroke="#8b5cf6"
                    fill="url(#gradSuccess)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="成功率データがまだありません" />
            )}
          </div>

          {/* Knowledge Distribution */}
          <div className="p-6 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm dark:shadow-2xl dark:shadow-black/50">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-lg">
                <TrendingUp className="w-5 h-5" />
              </div>
              <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
                知識分布
              </h3>
            </div>

            {memoryOverview &&
            memoryOverview.knowledgeDistribution.length > 0 ? (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width="55%" height={240}>
                  <PieChart>
                    <Pie
                      data={memoryOverview.knowledgeDistribution.map((d) => ({
                        name: NODE_TYPE_LABELS[d.category] ?? d.category,
                        value: d.count,
                      }))}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {memoryOverview.knowledgeDistribution.map((_, i) => (
                        <Cell
                          key={`cell-${i}`}
                          fill={PIE_COLORS[i % PIE_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--color-zinc-800, #27272a)',
                        border: '1px solid var(--color-zinc-700, #3f3f46)',
                        borderRadius: '8px',
                        color: '#f4f4f5',
                        fontSize: '13px',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-2">
                  {memoryOverview.knowledgeDistribution.map((item, i) => (
                    <div
                      key={item.category}
                      className="flex items-center gap-2"
                    >
                      <div
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{
                          backgroundColor: PIE_COLORS[i % PIE_COLORS.length],
                        }}
                      />
                      <span className="text-sm text-zinc-700 dark:text-zinc-300 flex-1 truncate">
                        {NODE_TYPE_LABELS[item.category] ?? item.category}
                      </span>
                      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {item.count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyChart message="まだ知識が蓄積されていません" />
            )}
          </div>
        </div>

        {/* Confidence Trend */}
        {growthTimeline && growthTimeline.timeline.length > 0 && (
          <div className="mb-8 p-6 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm dark:shadow-2xl dark:shadow-black/50">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-lg">
                <Target className="w-5 h-5" />
              </div>
              <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
                信頼度の推移
              </h3>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={growthTimeline.timeline.filter(
                  (d) => d.avgConfidence > 0,
                )}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  className="stroke-zinc-200 dark:stroke-zinc-700"
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  className="fill-zinc-500"
                  tickFormatter={formatChartDate}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  className="fill-zinc-500"
                  domain={[0, 1]}
                  tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--color-zinc-800, #27272a)',
                    border: '1px solid var(--color-zinc-700, #3f3f46)',
                    borderRadius: '8px',
                    color: '#f4f4f5',
                    fontSize: '13px',
                  }}
                  formatter={
                    ((v: unknown) => [
                      `${(Number(v) * 100).toFixed(1)}%`,
                      '信頼度',
                    ]) as never
                  }
                />
                <Bar
                  dataKey="avgConfidence"
                  fill="#f59e0b"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Recent Learnings - Two Column */}
        {memoryOverview && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Latest Patterns */}
            <div className="p-6 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm dark:shadow-2xl dark:shadow-black/50">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 rounded-lg">
                  <Sparkles className="w-5 h-5" />
                </div>
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
                  最近の学習パターン
                </h3>
              </div>
              {memoryOverview.recentHighlights.latestPatterns.length > 0 ? (
                <div className="space-y-3">
                  {memoryOverview.recentHighlights.latestPatterns
                    .slice(0, 5)
                    .map((pattern) => (
                      <div
                        key={pattern.id}
                        className="p-3 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg"
                      >
                        <p className="text-sm text-zinc-900 dark:text-zinc-100 line-clamp-2 mb-1">
                          {pattern.description}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                          <span className="flex items-center gap-1">
                            <Target className="w-3 h-3" />
                            信頼度 {(pattern.confidence * 100).toFixed(0)}%
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDate(pattern.createdAt)}
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              ) : (
                <div className="text-center py-8 text-zinc-500 dark:text-zinc-400 text-sm">
                  パターンがまだありません
                </div>
              )}
            </div>

            {/* Latest Knowledge Nodes */}
            <div className="p-6 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm dark:shadow-2xl dark:shadow-black/50">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg">
                  <Network className="w-5 h-5" />
                </div>
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
                  最新のナレッジノード
                </h3>
              </div>
              {memoryOverview.recentHighlights.latestNodes.length > 0 ? (
                <div className="space-y-3">
                  {memoryOverview.recentHighlights.latestNodes
                    .slice(0, 5)
                    .map((node) => (
                      <div
                        key={node.id}
                        className="p-3 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg flex items-center justify-between"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                            {node.label}
                          </p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            {NODE_TYPE_LABELS[node.nodeType] ?? node.nodeType}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-3">
                          <span className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full">
                            w: {node.weight.toFixed(1)}
                          </span>
                          <span className="text-xs text-zinc-400 dark:text-zinc-500">
                            {formatDate(node.createdAt)}
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              ) : (
                <div className="text-center py-8 text-zinc-500 dark:text-zinc-400 text-sm">
                  ノードがまだありません
                </div>
              )}
            </div>
          </div>
        )}

        {/* Empty State */}
        {!memoryOverview && !loading && !error && (
          <div className="text-center py-16">
            <Brain className="w-16 h-16 text-zinc-300 dark:text-zinc-600 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-zinc-600 dark:text-zinc-400 mb-2">
              記憶データがありません
            </h2>
            <p className="text-zinc-500 dark:text-zinc-400">
              エージェントがタスクを実行すると、ここに学習の成長が表示されます
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Sub Components ---

function GrowthBadge({ value, label }: { value: number; label: string }) {
  return (
    <div className="mt-3 flex items-center gap-1 text-sm">
      {value >= 0 ? (
        <>
          <ArrowUpRight className="w-4 h-4" />
          <span>+{value.toFixed(1)}%</span>
        </>
      ) : (
        <>
          <ArrowDownRight className="w-4 h-4" />
          <span>{value.toFixed(1)}%</span>
        </>
      )}
      <span className="opacity-70 ml-1">{label}</span>
    </div>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="h-60 flex flex-col items-center justify-center text-zinc-400 dark:text-zinc-500">
      <Brain className="w-12 h-12 mb-3 opacity-30" />
      <p className="text-sm">{message}</p>
    </div>
  );
}
