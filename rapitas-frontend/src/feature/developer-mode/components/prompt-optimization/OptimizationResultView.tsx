/**
 * OptimizationResultView
 *
 * Displays the final optimized prompt result: prompt text, quality score header,
 * copy/use actions, score breakdown, structured sections, and a re-generate button.
 */

'use client';

import {
  Sparkles,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Target,
  FileText,
  AlertTriangle,
  Lightbulb,
  CheckCircle2,
} from 'lucide-react';
import type { OptimizedPromptResult } from './prompt-optimization-types';
import { getQualityColor } from './prompt-optimization-types';
import { ScoreBreakdownSection } from './ScoreBreakdownSection';

type Props = {
  result: OptimizedPromptResult;
  showDetails: boolean;
  copied: boolean;
  onToggleDetails: () => void;
  onCopy: () => void;
  onUse: () => void;
  onRegenerate: () => void;
  className?: string;
};

/**
 * Full result display for a completed prompt optimization.
 *
 * @param props - OptimizationResultView props
 */
export function OptimizationResultView({
  result,
  showDetails,
  copied,
  onToggleDetails,
  onCopy,
  onUse,
  onRegenerate,
  className = '',
}: Props) {
  return (
    <div
      className={`bg-white dark:bg-indigo-dark-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden ${className}`}
    >
      {/* Header */}
      <div className="px-6 py-4 bg-linear-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border-b border-zinc-200 dark:border-zinc-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 dark:bg-green-900/40 rounded-lg">
              <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">
                最適化されたプロンプト
              </h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                品質スコア:{' '}
                <span
                  className={`font-medium ${getQualityColor(result.promptQuality.score)}`}
                >
                  {result.promptQuality.score}/100
                </span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
            >
              {copied ? (
                <Check className="w-4 h-4 text-green-500" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
              コピー
            </button>
            <button
              onClick={onUse}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors"
            >
              <Sparkles className="w-4 h-4" />
              このプロンプトを使用
            </button>
          </div>
        </div>
      </div>

      {/* Prompt text */}
      <div className="px-6 py-4">
        <div className="bg-zinc-50 dark:bg-indigo-dark-800/50 rounded-lg p-4 font-mono text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap max-h-60 overflow-y-auto">
          {result.optimizedPrompt}
        </div>
      </div>

      {/* Score breakdown */}
      {result.promptQuality.breakdown && (
        <ScoreBreakdownSection
          breakdown={result.promptQuality.breakdown}
          showDetails={showDetails}
          onToggle={onToggleDetails}
        />
      )}

      {/* Issues & Suggestions */}
      {(result.promptQuality.issues.length > 0 ||
        result.promptQuality.suggestions.length > 0) && (
        <div className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-700 space-y-3">
          {result.promptQuality.issues.length > 0 && (
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
              <div className="text-sm text-amber-700 dark:text-amber-400">
                <span className="font-medium">注意点: </span>
                {result.promptQuality.issues.join(', ')}
              </div>
            </div>
          )}
          {result.promptQuality.suggestions.length > 0 && (
            <div className="flex items-start gap-2">
              <Lightbulb className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
              <div className="text-sm text-blue-700 dark:text-blue-400">
                <span className="font-medium">提案: </span>
                {result.promptQuality.suggestions.join(', ')}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Structured details toggle */}
      <button
        onClick={onToggleDetails}
        className="w-full px-6 py-3 flex items-center justify-between bg-zinc-50 dark:bg-indigo-dark-800/30 border-t border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors"
      >
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          構造化された詳細を表示
        </span>
        {showDetails ? (
          <ChevronUp className="w-4 h-4 text-zinc-500" />
        ) : (
          <ChevronDown className="w-4 h-4 text-zinc-500" />
        )}
      </button>

      {showDetails && (
        <div className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-700 space-y-4">
          <div className="flex items-start gap-3">
            <Target className="w-4 h-4 text-violet-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-medium text-violet-600 dark:text-violet-400 uppercase tracking-wide mb-1">
                目標
              </p>
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                {result.structuredSections.objective}
              </p>
            </div>
          </div>

          {result.structuredSections.context && (
            <div className="flex items-start gap-3">
              <FileText className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wide mb-1">
                  背景・コンテキスト
                </p>
                <p className="text-sm text-zinc-700 dark:text-zinc-300">
                  {result.structuredSections.context}
                </p>
              </div>
            </div>
          )}

          {result.structuredSections.requirements.length > 0 && (
            <div>
              <p className="text-xs font-medium text-green-600 dark:text-green-400 uppercase tracking-wide mb-2">
                要件
              </p>
              <ul className="space-y-1">
                {result.structuredSections.requirements.map((req, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300"
                  >
                    <span className="text-green-500 mt-0.5">•</span>
                    {req}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.structuredSections.constraints.length > 0 && (
            <div>
              <p className="text-xs font-medium text-orange-600 dark:text-orange-400 uppercase tracking-wide mb-2">
                制約条件
              </p>
              <ul className="space-y-1">
                {result.structuredSections.constraints.map((con, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300"
                  >
                    <span className="text-orange-500 mt-0.5">•</span>
                    {con}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.structuredSections.deliverables.length > 0 && (
            <div>
              <p className="text-xs font-medium text-purple-600 dark:text-purple-400 uppercase tracking-wide mb-2">
                成果物
              </p>
              <ul className="space-y-1">
                {result.structuredSections.deliverables.map((del, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300"
                  >
                    <span className="text-purple-500 mt-0.5">•</span>
                    {del}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Re-generate */}
      <div className="flex items-center justify-center px-6 py-4 border-t border-zinc-200 dark:border-zinc-700">
        <button
          onClick={onRegenerate}
          className="text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
        >
          プロンプトを再生成
        </button>
      </div>
    </div>
  );
}
