'use client';

import { useState, useEffect } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Info,
  BarChart3,
  Loader2,
} from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import type { WorkflowMode } from './CompactWorkflowSelector';
import { createLogger } from '@/lib/logger';
const logger = createLogger('ComplexityIndicator');

export interface ComplexityScore {
  complexityScore: number; // 0-100
  confidence: number; // 0-1
  factors: {
    keywords: number;
    estimatedTime: number;
    priority: number;
    labels: number;
  };
  reasoning: string[];
  recommendedMode: WorkflowMode;
}

export interface ComplexityIndicatorProps {
  taskId: number;
  complexityScore?: number | null;
  showAnalysis?: boolean;
  onAnalysisComplete?: (analysis: ComplexityScore) => void;
  className?: string;
}

const getComplexityLevel = (
  score: number,
): {
  level: 'low' | 'medium' | 'high';
  label: string;
  color: string;
  bgColor: string;
  icon: typeof TrendingDown;
} => {
  if (score <= 30) {
    return {
      level: 'low',
      label: '低複雑度',
      color: 'text-green-600 dark:text-green-400',
      bgColor: 'bg-green-50 dark:bg-green-900/20',
      icon: TrendingDown,
    };
  } else if (score <= 70) {
    return {
      level: 'medium',
      label: '中複雑度',
      color: 'text-amber-600 dark:text-amber-400',
      bgColor: 'bg-amber-50 dark:bg-amber-900/20',
      icon: Minus,
    };
  } else {
    return {
      level: 'high',
      label: '高複雑度',
      color: 'text-red-600 dark:text-red-400',
      bgColor: 'bg-red-50 dark:bg-red-900/20',
      icon: TrendingUp,
    };
  }
};

export default function ComplexityIndicator({
  taskId,
  complexityScore = null,
  showAnalysis = true,
  onAnalysisComplete,
  className = '',
}: ComplexityIndicatorProps) {
  const [analysis, setAnalysis] = useState<ComplexityScore | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveScore = analysis?.complexityScore ?? complexityScore;
  const complexity =
    effectiveScore !== null && effectiveScore !== undefined
      ? getComplexityLevel(effectiveScore)
      : null;

  const handleAnalyze = async () => {
    if (!showAnalysis) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/workflow/tasks/${taskId}/analyze-complexity`,
      );
      const data = await response.json();

      if (data.success && data.analysis) {
        setAnalysis(data.analysis);
        onAnalysisComplete?.(data.analysis);
      } else {
        setError(data.error || '分析に失敗しました');
      }
    } catch (err) {
      setError('分析中にエラーが発生しました');
      logger.error('Error analyzing complexity:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // コンポーネントマウント時に自動分析（スコアがない場合）
  useEffect(() => {
    if (showAnalysis && effectiveScore === null && !isLoading && !analysis) {
      handleAnalyze();
    }
  }, [taskId, effectiveScore, showAnalysis]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!complexity && !isLoading) {
    return (
      <div className={className}>
        <button
          onClick={handleAnalyze}
          disabled={isLoading}
          className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50"
        >
          <BarChart3 className="h-4 w-4" />
          複雑度を分析
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div
        className={`flex items-center gap-2 px-3 py-2 bg-zinc-50 dark:bg-zinc-800 rounded-lg ${className}`}
      >
        <Loader2 className="h-4 w-4 text-zinc-400 animate-spin" />
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          複雑度を分析中...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`flex items-center justify-between px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg ${className}`}
      >
        <span className="text-sm text-red-700 dark:text-red-300">{error}</span>
        <button
          onClick={handleAnalyze}
          className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-xs"
        >
          再試行
        </button>
      </div>
    );
  }

  if (!complexity) return null;

  const ComplexityIcon = complexity.icon;

  return (
    <div className={className}>
      <div
        className={`p-3 rounded-lg border border-zinc-200 dark:border-zinc-700 ${complexity.bgColor}`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`p-1.5 rounded-full bg-white dark:bg-zinc-800 ${complexity.color}`}
            >
              <ComplexityIcon className="h-3.5 w-3.5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-medium ${complexity.color}`}>
                  {complexity.label}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  スコア: {effectiveScore}/100
                </span>
                {analysis?.confidence && (
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    信頼度: {Math.round(analysis.confidence * 100)}%
                  </span>
                )}
              </div>
              <div className="mt-1">
                <div className="w-24 h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      complexity.level === 'low'
                        ? 'bg-green-500'
                        : complexity.level === 'medium'
                          ? 'bg-amber-500'
                          : 'bg-red-500'
                    }`}
                    style={{ width: `${effectiveScore}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {analysis && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-1 px-2 py-1 text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors"
            >
              <Info className="h-3 w-3" />
              詳細 {isExpanded ? '▼' : '▶'}
            </button>
          )}
        </div>

        {/* 詳細分析結果 */}
        {isExpanded && analysis && (
          <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-700 space-y-3">
            {/* 推奨ワークフローモード */}
            <div>
              <h4 className="text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                推奨ワークフローモード
              </h4>
              <span
                className={`inline-block px-2 py-1 rounded-md text-xs font-medium ${
                  analysis.recommendedMode === 'lightweight'
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                    : analysis.recommendedMode === 'standard'
                      ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                      : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                }`}
              >
                {analysis.recommendedMode === 'lightweight' && '軽量モード'}
                {analysis.recommendedMode === 'standard' && '標準モード'}
                {analysis.recommendedMode === 'comprehensive' && '詳細モード'}
              </span>
            </div>

            {/* 各要素のスコア */}
            <div>
              <h4 className="text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                分析要素
              </h4>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-zinc-600 dark:text-zinc-400">
                    キーワード:
                  </span>
                  <span className="font-medium">
                    {analysis.factors.keywords}/100
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-600 dark:text-zinc-400">
                    推定時間:
                  </span>
                  <span className="font-medium">
                    {analysis.factors.estimatedTime}/100
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-600 dark:text-zinc-400">
                    優先度:
                  </span>
                  <span className="font-medium">
                    {analysis.factors.priority}/100
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-600 dark:text-zinc-400">
                    ラベル:
                  </span>
                  <span className="font-medium">
                    {analysis.factors.labels}/100
                  </span>
                </div>
              </div>
            </div>

            {/* 分析根拠 */}
            {analysis.reasoning && analysis.reasoning.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  分析根拠
                </h4>
                <ul className="text-xs text-zinc-600 dark:text-zinc-400 space-y-0.5">
                  {analysis.reasoning.map((reason, index) => (
                    <li key={index} className="flex items-start gap-1">
                      <span className="text-zinc-400 mt-0.5">•</span>
                      <span>{reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 再分析ボタン */}
            <button
              onClick={handleAnalyze}
              disabled={isLoading}
              className="w-full mt-2 px-3 py-1.5 text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 border border-zinc-200 dark:border-zinc-600 rounded-md hover:bg-white dark:hover:bg-zinc-700 transition-colors disabled:opacity-50"
            >
              再分析
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
