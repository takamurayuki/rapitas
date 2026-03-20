/**
 * MemoryStrengthCard
 *
 * Hero card showing the agent's overall memory strength score, level badge,
 * an animated progress bar, and level-scale labels.
 */

'use client';

import { Brain } from 'lucide-react';
import { LEVEL_CONFIG, LEVEL_LABELS } from '../constants';
import type { MemoryOverview } from '../types';

interface MemoryStrengthCardProps {
  memoryOverview: MemoryOverview;
}

/**
 * Renders the memory strength hero section.
 *
 * @param memoryOverview - Full overview data including strength score and level.
 */
export function MemoryStrengthCard({ memoryOverview }: MemoryStrengthCardProps) {
  const levelCfg =
    LEVEL_CONFIG[memoryOverview.memoryStrength.level] ?? LEVEL_CONFIG.beginner;

  return (
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
          <div className="text-sm text-zinc-500 dark:text-zinc-400">/ 100</div>
        </div>
      </div>

      {/* Animated progress bar */}
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
  );
}
