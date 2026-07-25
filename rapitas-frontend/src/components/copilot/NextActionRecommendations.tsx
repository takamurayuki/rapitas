'use client';

/**
 * NextActionRecommendations
 *
 * Renders the copilot's rule-based "next action" suggestions as one-click
 * cards. Pure view — the recommendations and the execute handler are provided
 * by the parent (CopilotChatPanel).
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Sparkles,
  SplitSquareVertical,
  Play,
  CheckCircle2,
  Clock,
  NotebookPen,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import type { RecommendedAction, NextActionIcon } from './next-action-recommender';

const ICONS: Record<NextActionIcon, typeof Sparkles> = {
  analyze: Sparkles,
  split: SplitSquareVertical,
  play: Play,
  check: CheckCircle2,
  estimate: Clock,
  reflect: NotebookPen,
  alert: AlertCircle,
};

interface NextActionRecommendationsProps {
  actions: RecommendedAction[];
  /** Dispatches the selected recommendation (action or chat prompt). */
  onSelect: (action: RecommendedAction) => void;
  /** True while an action is running (disables the cards). */
  isBusy: boolean;
}

/**
 * Renders the next-action recommendation cards.
 *
 * @param actions - Recommendations to show / 表示する推奨アクション
 * @param onExecute - One-click execute handler / ワンクリック実行ハンドラ
 * @param isBusy - Whether an action is in flight / アクション実行中か
 */
export function NextActionRecommendations({
  actions,
  onSelect,
  isBusy,
}: NextActionRecommendationsProps) {
  const t = useTranslations('copilot.nextActionRecommendations');
  // Track which card was clicked so only IT shows a spinner (not all of them).
  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => {
    if (!isBusy) setActiveId(null);
  }, [isBusy]);

  if (actions.length === 0) {
    return (
      <p className="rounded-lg border border-zinc-200 px-3 py-4 text-center text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        {t('noRecommendations')}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-500">{t('heading')}</p>
      {actions.map((a) => {
        const Icon = ICONS[a.icon];
        const isPrimary = a.tone === 'primary';
        const isActive = activeId === a.id;
        return (
          <button
            key={a.id}
            type="button"
            disabled={isBusy}
            onClick={() => {
              setActiveId(a.id);
              onSelect(a);
            }}
            className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
              isBusy && !isActive ? 'opacity-50' : ''
            } ${
              isPrimary
                ? 'border-indigo-200 bg-indigo-50/50 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/20 dark:hover:bg-indigo-900/40'
                : 'border-zinc-200 hover:border-indigo-300 hover:bg-indigo-50/40 dark:border-zinc-700 dark:hover:border-indigo-700 dark:hover:bg-indigo-900/15'
            }`}
          >
            <span
              className={`mt-0.5 shrink-0 ${
                isPrimary ? 'text-indigo-600 dark:text-indigo-400' : 'text-indigo-500'
              }`}
            >
              {isActive ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Icon className="h-4 w-4" />
              )}
            </span>
            <span className="min-w-0">
              <span
                className={`block text-sm font-medium ${
                  isPrimary
                    ? 'text-indigo-800 dark:text-indigo-200'
                    : 'text-zinc-800 dark:text-zinc-200'
                }`}
              >
                {t(a.labelKey)}
              </span>
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                {t(a.reasonKey, a.reasonParams)}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
