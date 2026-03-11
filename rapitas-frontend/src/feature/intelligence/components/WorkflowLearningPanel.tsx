'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Brain,
  TrendingUp,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ToggleLeft,
  ToggleRight,
  Zap,
  BarChart3,
  Layers,
} from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('WorkflowLearningPanel');

type ModeStats = {
  mode: string;
  count: number;
  successRate: number;
  avgDuration: number;
};

type LearningStats = {
  totalRecords: number;
  modeStats: ModeStats[];
  overrideRate: number;
  predictionAccuracy: number;
};

type OptimizationRule = {
  id: number;
  ruleType: string;
  condition: Record<string, unknown>;
  recommendation: Record<string, unknown>;
  confidence: number;
  sampleSize: number;
  isActive: boolean;
  description: string | null;
  createdAt: string;
};

const ruleTypeLabels: Record<string, string> = {
  skip_phase: 'フェーズスキップ',
  downgrade_mode: 'モード軽量化',
  upgrade_mode: 'モード強化',
  adjust_time: '時間調整',
};

const ruleTypeColors: Record<string, string> = {
  skip_phase:
    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  downgrade_mode:
    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  upgrade_mode:
    'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  adjust_time:
    'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
};

const modeLabels: Record<string, string> = {
  lightweight: '軽量',
  standard: '標準',
  comprehensive: '包括的',
};

export function WorkflowLearningPanel() {
  const [stats, setStats] = useState<LearningStats | null>(null);
  const [rules, setRules] = useState<OptimizationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRules, setShowRules] = useState(false);
  const [generating, setGenerating] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, rulesRes] = await Promise.all([
        fetch(`${API_BASE_URL}/workflow/learning/stats`),
        fetch(`${API_BASE_URL}/workflow/learning/rules`),
      ]);

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData.stats);
      }
      if (rulesRes.ok) {
        const rulesData = await rulesRes.json();
        setRules(rulesData.rules || []);
      }
    } catch (e) {
      logger.warn('Failed to fetch workflow learning data:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleGenerateRules = async () => {
    setGenerating(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/workflow/learning/rules/generate`,
        {
          method: 'POST',
        },
      );
      if (res.ok) {
        await fetchData();
      }
    } catch (e) {
      logger.warn('Failed to generate rules:', e);
    } finally {
      setGenerating(false);
    }
  };

  const handleToggleRule = async (ruleId: number, isActive: boolean) => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/workflow/learning/rules/${ruleId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive: !isActive }),
        },
      );
      if (res.ok) {
        setRules((prev) =>
          prev.map((r) =>
            r.id === ruleId ? { ...r, isActive: !isActive } : r,
          ),
        );
      }
    } catch (e) {
      logger.warn('Failed to toggle rule:', e);
    }
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-zinc-200 dark:bg-zinc-700 rounded w-48" />
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-20 bg-zinc-200 dark:bg-zinc-700 rounded-lg"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const activeRules = rules.filter((r) => r.isActive);

  return (
    <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-2">
          <Brain className="w-5 h-5 text-violet-500" />
          ワークフロー学習
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleGenerateRules}
            disabled={generating}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 hover:bg-violet-200 dark:hover:bg-violet-800/40 rounded-lg transition-colors disabled:opacity-50"
          >
            {generating ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Zap className="w-3.5 h-3.5" />
            )}
            ルール生成
          </button>
        </div>
      </div>

      {/* Stats overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="text-center p-3 rounded-lg bg-zinc-50 dark:bg-zinc-700/50">
          <div className="text-xl font-bold text-zinc-800 dark:text-zinc-200">
            {stats.totalRecords}
          </div>
          <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
            学習記録
          </div>
        </div>
        <div className="text-center p-3 rounded-lg bg-zinc-50 dark:bg-zinc-700/50">
          <div className="text-xl font-bold text-violet-600 dark:text-violet-400">
            {activeRules.length}
          </div>
          <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
            有効ルール
          </div>
        </div>
        <div className="text-center p-3 rounded-lg bg-zinc-50 dark:bg-zinc-700/50">
          <div className="text-xl font-bold text-zinc-800 dark:text-zinc-200">
            {Math.round(stats.overrideRate * 100)}%
          </div>
          <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
            オーバーライド率
          </div>
        </div>
        <div className="text-center p-3 rounded-lg bg-zinc-50 dark:bg-zinc-700/50">
          <div className="text-xl font-bold text-green-600 dark:text-green-400">
            {Math.round(stats.predictionAccuracy * 100)}%
          </div>
          <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
            予測精度
          </div>
        </div>
      </div>

      {/* Mode stats */}
      {stats.modeStats.length > 0 && (
        <div className="mb-4">
          <h3 className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2 flex items-center gap-1.5">
            <BarChart3 className="w-3.5 h-3.5" />
            モード別実績
          </h3>
          <div className="space-y-1.5">
            {stats.modeStats.map((ms) => (
              <div
                key={ms.mode}
                className="flex items-center gap-3 p-2 rounded-lg bg-zinc-50 dark:bg-zinc-700/30"
              >
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300 w-16">
                  {modeLabels[ms.mode] || ms.mode}
                </span>
                <div className="flex-1">
                  <div className="h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-violet-500 rounded-full transition-all"
                      style={{ width: `${ms.successRate * 100}%` }}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-zinc-500 dark:text-zinc-400 shrink-0">
                  <span>{ms.count}件</span>
                  <span className="text-green-600 dark:text-green-400">
                    {Math.round(ms.successRate * 100)}%
                  </span>
                  <span>{Math.round(ms.avgDuration)}分</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rules section */}
      <div>
        <button
          onClick={() => setShowRules(!showRules)}
          className="flex items-center justify-between w-full py-2 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5" />
            最適化ルール ({rules.length})
          </span>
          {showRules ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>

        {showRules && (
          <div className="space-y-2 mt-1">
            {rules.length === 0 ? (
              <p className="text-xs text-zinc-400 dark:text-zinc-500 py-3 text-center">
                学習データが蓄積されるとルールが自動生成されます
              </p>
            ) : (
              rules.map((rule) => (
                <div
                  key={rule.id}
                  className={`flex items-start gap-2 p-2.5 rounded-lg border transition-colors ${
                    rule.isActive
                      ? 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700'
                      : 'bg-zinc-50 dark:bg-zinc-800/50 border-zinc-100 dark:border-zinc-800 opacity-60'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${ruleTypeColors[rule.ruleType] || 'bg-gray-100 text-gray-600'}`}
                      >
                        {ruleTypeLabels[rule.ruleType] || rule.ruleType}
                      </span>
                      <span className="text-[10px] text-zinc-400">
                        信頼度: {Math.round(rule.confidence * 100)}%
                      </span>
                      <span className="text-[10px] text-zinc-400">
                        ({rule.sampleSize}件)
                      </span>
                    </div>
                    {rule.description && (
                      <p className="text-xs text-zinc-600 dark:text-zinc-400 truncate">
                        {rule.description}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => handleToggleRule(rule.id, rule.isActive)}
                    className="p-1 shrink-0"
                    title={rule.isActive ? '無効化' : '有効化'}
                  >
                    {rule.isActive ? (
                      <ToggleRight className="w-5 h-5 text-violet-500" />
                    ) : (
                      <ToggleLeft className="w-5 h-5 text-zinc-400" />
                    )}
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
