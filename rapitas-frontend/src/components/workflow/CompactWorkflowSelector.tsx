'use client';

import { useState, useEffect } from 'react';
import {
  Zap,
  Target,
  Microscope,
  BarChart3,
  Info,
  Loader2,
  TrendingDown,
  TrendingUp,
  Minus,
} from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
const logger = createLogger('CompactWorkflowSelector');

export type WorkflowMode = 'lightweight' | 'standard' | 'comprehensive';

export interface WorkflowModeConfig {
  mode: WorkflowMode;
  name: string;
  description: string;
  estimatedTime: string;
  steps: string[];
  icon: typeof Zap | typeof Target | typeof Microscope;
  color: string;
  bgColor: string;
}

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

const WORKFLOW_MODE_CONFIGS: Record<WorkflowMode, WorkflowModeConfig> = {
  lightweight: {
    mode: 'lightweight',
    name: '軽量',
    description: 'バグ修正、UI調整、軽微な変更に最適',
    estimatedTime: '15-30分',
    steps: ['実装', '自動検証'],
    icon: Zap,
    color: 'text-green-600 dark:text-green-400',
    bgColor:
      'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800/50',
  },
  standard: {
    mode: 'standard',
    name: '標準',
    description: '中規模機能追加、リファクタリングに最適',
    estimatedTime: '1-2時間',
    steps: ['計画作成', '実装', '検証'],
    icon: Target,
    color: 'text-blue-600 dark:text-blue-400',
    bgColor:
      'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800/50',
  },
  comprehensive: {
    mode: 'comprehensive',
    name: '詳細',
    description: '大規模機能、アーキテクチャ変更に最適',
    estimatedTime: '3-4時間',
    steps: ['調査', '計画作成', '実装', '検証'],
    icon: Microscope,
    color: 'text-purple-600 dark:text-purple-400',
    bgColor:
      'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800/50',
  },
};

export interface CompactWorkflowSelectorProps {
  taskId: number;
  currentMode?: WorkflowMode | null;
  isOverridden?: boolean;
  complexityScore?: number | null;
  autoComplexityAnalysis?: boolean;
  onModeChange?: (mode: WorkflowMode, isOverride: boolean) => void;
  onAnalysisComplete?: (analysis: ComplexityScore) => void;
  disabled?: boolean;
  showAnalyzeButton?: boolean;
  className?: string;
}

const getComplexityLevel = (
  score: number,
): {
  level: 'low' | 'medium' | 'high';
  label: string;
  color: string;
  icon: typeof TrendingDown;
} => {
  if (score <= 30) {
    return {
      level: 'low',
      label: '低',
      color: 'text-green-600 dark:text-green-400',
      icon: TrendingDown,
    };
  } else if (score <= 70) {
    return {
      level: 'medium',
      label: '中',
      color: 'text-amber-600 dark:text-amber-400',
      icon: Minus,
    };
  } else {
    return {
      level: 'high',
      label: '高',
      color: 'text-red-600 dark:text-red-400',
      icon: TrendingUp,
    };
  }
};

export default function CompactWorkflowSelector({
  taskId,
  currentMode = 'comprehensive',
  isOverridden = false,
  complexityScore = null,
  autoComplexityAnalysis = false,
  onModeChange,
  onAnalysisComplete,
  disabled = false,
  showAnalyzeButton = true,
  className = '',
}: CompactWorkflowSelectorProps) {
  const [selectedMode, setSelectedMode] = useState<WorkflowMode>(
    currentMode || 'comprehensive',
  );
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [analysis, setAnalysis] = useState<ComplexityScore | null>(null);
  const [showTooltip, setShowTooltip] = useState<WorkflowMode | null>(null);

  useEffect(() => {
    if (currentMode) {
      setSelectedMode(currentMode);
    }
  }, [currentMode]);

  // 自動分析ON時、complexityScoreがない場合に自動実行（taskId=0は新規タスクなのでスキップ）
  useEffect(() => {
    if (
      autoComplexityAnalysis &&
      complexityScore === null &&
      !analysis &&
      !isAnalyzing &&
      taskId > 0
    ) {
      handleAnalyze();
    }
  }, [autoComplexityAnalysis, complexityScore]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleModeSelect = async (mode: WorkflowMode) => {
    if (mode === selectedMode || disabled || autoComplexityAnalysis) return;

    setIsUpdating(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/workflow/tasks/${taskId}/set-mode`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode, override: true }),
        },
      );

      const data = await response.json();
      if (data.success) {
        setSelectedMode(mode);
        onModeChange?.(mode, true);
      } else {
        logger.error('Failed to set workflow mode:', data.error);
      }
    } catch (err) {
      logger.error('Error setting workflow mode:', err);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/workflow/tasks/${taskId}/analyze-complexity`,
      );
      const data = await response.json();

      if (data.success && data.analysis) {
        setAnalysis(data.analysis);
        onAnalysisComplete?.(data.analysis);

        // 推奨モードがある場合、自動選択
        if (data.analysis.recommendedMode && !isOverridden) {
          const recommendedMode = data.analysis.recommendedMode as WorkflowMode;
          setSelectedMode(recommendedMode);
          onModeChange?.(recommendedMode, false);
        }
      } else {
        logger.error('Failed to analyze complexity:', data.error);
      }
    } catch (err) {
      logger.error('Error analyzing complexity:', err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const effectiveScore = analysis?.complexityScore ?? complexityScore;
  const complexity =
    effectiveScore !== null && effectiveScore !== undefined
      ? getComplexityLevel(effectiveScore)
      : null;

  return (
    <div className={`max-w-2xl ${className}`}>
      {/* メインセレクター - 1行レイアウト */}
      <div className="flex items-center gap-3 p-3 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg">
        {/* 複雑度表示 - 一番左 */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
            <span className="font-medium">タスクの複雑度:</span>
            {complexity ? (
              <span
                className={`font-semibold ${complexity.color} bg-white dark:bg-zinc-700 px-2 py-1 rounded-md border`}
              >
                {complexity.label}
              </span>
            ) : (
              <span className="text-zinc-400 dark:text-zinc-500 px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-600">
                未分析
              </span>
            )}
            {effectiveScore !== null && effectiveScore !== undefined && (
              <span className="text-xs text-zinc-400 dark:text-zinc-500">
                ({effectiveScore})
              </span>
            )}
          </div>
        </div>

        {/* 区切り線 */}
        <div className="h-6 w-px bg-zinc-300 dark:bg-zinc-600" />

        {/* ワークフローモード選択ボタン */}
        <div className="flex items-center gap-1">
          {(
            Object.entries(WORKFLOW_MODE_CONFIGS) as [
              WorkflowMode,
              WorkflowModeConfig,
            ][]
          ).map(([mode, config]) => {
            const isSelected = mode === selectedMode;
            const ModeIcon = config.icon;

            return (
              <div
                key={mode}
                className="relative"
                onMouseEnter={() => setShowTooltip(mode)}
                onMouseLeave={() => setShowTooltip(null)}
              >
                <button
                  onClick={() => handleModeSelect(mode)}
                  disabled={disabled || isUpdating || autoComplexityAnalysis}
                  className={`
                    flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition-all
                    disabled:opacity-50 disabled:cursor-not-allowed
                    ${
                      isSelected
                        ? `${config.color} ${config.bgColor} border border-current shadow-sm`
                        : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700/50'
                    }
                  `}
                  title={`${config.description} (${config.estimatedTime})`}
                >
                  {isUpdating && isSelected ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ModeIcon className="h-4 w-4" />
                  )}
                  <span>{config.name}</span>
                </button>

                {/* ツールチップ */}
                {showTooltip === mode && (
                  <div className="absolute z-10 bottom-full left-1/2 transform -translate-x-1/2 mb-1 px-2 py-1.5 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs rounded-md whitespace-nowrap shadow-lg">
                    <div className="font-medium">{config.description}</div>
                    <div className="text-zinc-300 dark:text-zinc-600 mt-0.5">
                      {config.estimatedTime} • {config.steps.join(' → ')}
                    </div>
                    {/* 矢印 */}
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-2 border-transparent border-t-zinc-900 dark:border-t-zinc-100" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 区切り線 */}
        <div className="h-6 w-px bg-zinc-300 dark:bg-zinc-600" />

        {/* 自動分析ボタン - 右端で目立つように */}
        {showAnalyzeButton && (
          <button
            onClick={handleAnalyze}
            disabled={disabled || isAnalyzing || isUpdating}
            className={`
              flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md transition-colors
              disabled:opacity-50 disabled:cursor-not-allowed
              ${
                isAnalyzing
                  ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700'
                  : 'bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700 hover:from-blue-100 hover:to-indigo-100 dark:hover:from-blue-800/30 dark:hover:to-indigo-800/30 shadow-sm'
              }
            `}
            title="タスクの複雑度を自動分析してモードを提案"
          >
            {isAnalyzing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Info className="h-4 w-4" />
            )}
            <span className="font-medium">
              {autoComplexityAnalysis ? '再分析' : '自動分析'}
            </span>
          </button>
        )}

        {/* モード設定バッジ */}
        {autoComplexityAnalysis ? (
          <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-800/50 text-blue-700 dark:text-blue-300 text-xs font-medium rounded-full">
            自動
          </span>
        ) : isOverridden ? (
          <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-800/50 text-amber-700 dark:text-amber-300 text-xs font-medium rounded-full">
            手動
          </span>
        ) : null}
      </div>

      {/* 推奨モード通知（分析後に表示） */}
      {analysis && analysis.recommendedMode !== selectedMode && (
        <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <div className="flex items-center gap-2 text-xs">
            <Info className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            <span className="text-blue-700 dark:text-blue-300">
              推奨:{' '}
              <strong>
                {WORKFLOW_MODE_CONFIGS[analysis.recommendedMode].name}モード
              </strong>
              （信頼度: {Math.round(analysis.confidence * 100)}%）
            </span>
            <button
              onClick={() => handleModeSelect(analysis.recommendedMode)}
              className="ml-auto px-2 py-1 text-blue-700 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200 font-medium"
            >
              適用
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
