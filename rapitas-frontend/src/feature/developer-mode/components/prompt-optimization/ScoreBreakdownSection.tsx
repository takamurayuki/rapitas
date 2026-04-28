'use client';
// ScoreBreakdownSection

import { ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import type { ScoreBreakdown } from './prompt-optimization-types';

type ScoreBarProps = {
  label: string;
  score: number;
  max: number;
  thresholdHigh: number;
  thresholdMid: number;
};

/**
 * Renders a single labeled progress bar for one score dimension.
 *
 * @param props - ScoreBarProps
 */
function ScoreBar({ label, score, max, thresholdHigh, thresholdMid }: ScoreBarProps) {
  const barColor =
    score >= thresholdHigh
      ? 'bg-green-500'
      : score >= thresholdMid
        ? 'bg-yellow-500'
        : 'bg-red-500';

  return (
    <div className="flex items-center gap-3">
      <div className="w-28 text-sm text-zinc-600 dark:text-zinc-400">{label}</div>
      <div className="flex-1 h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all ${barColor}`}
          style={{ width: `${(score / max) * 100}%` }}
        />
      </div>
      <div className="w-12 text-right text-sm font-medium">
        {score}/{max}
      </div>
    </div>
  );
}

type Props = {
  breakdown: ScoreBreakdown;
  showDetails: boolean;
  onToggle: () => void;
};

/**
 * Expandable panel showing per-dimension quality scores and missing items.
 *
 * @param props - ScoreBreakdownSection props
 */
export function ScoreBreakdownSection({ breakdown, showDetails, onToggle }: Props) {
  return (
    <div className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-700">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
      >
        {showDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        スコア詳細を{showDetails ? '非表示' : '表示'}
      </button>

      {showDetails && (
        <div className="mt-4 space-y-3">
          <ScoreBar
            label="明確性"
            score={breakdown.clarity.score}
            max={20}
            thresholdHigh={15}
            thresholdMid={10}
          />
          <ScoreBar
            label="完全性"
            score={breakdown.completeness.score}
            max={25}
            thresholdHigh={20}
            thresholdMid={12}
          />
          <ScoreBar
            label="技術的具体性"
            score={breakdown.technicalSpecificity.score}
            max={20}
            thresholdHigh={15}
            thresholdMid={10}
          />
          <ScoreBar
            label="実行可能性"
            score={breakdown.executability.score}
            max={20}
            thresholdHigh={15}
            thresholdMid={10}
          />
          <ScoreBar
            label="コンテキスト"
            score={breakdown.context.score}
            max={15}
            thresholdHigh={12}
            thresholdMid={8}
          />

          {breakdown.completeness.missing && breakdown.completeness.missing.length > 0 && (
            <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                    不足している情報:
                  </p>
                  <ul className="mt-1 text-sm text-amber-600 dark:text-amber-300 list-disc list-inside">
                    {breakdown.completeness.missing.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
