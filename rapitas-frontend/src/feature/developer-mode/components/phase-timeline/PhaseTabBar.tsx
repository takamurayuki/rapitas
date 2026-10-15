'use client';

/**
 * phase-timeline/PhaseTabBar
 *
 * Terminal-style tab strip for the tabbed execution-log view (task #796):
 * one tab per phase with a status glyph and a repair-iteration count badge.
 * Owns only rendering/selection; which tab auto-follows the running phase is
 * the parent's job.
 */

import {
  FileSearch,
  FileText,
  Code,
  FlaskConical,
  CheckCircle2,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { PhaseType } from '../../utils/phase-selector';
import type { PhaseRunStatus } from '../../hooks/usePhaseTimeline';

const PHASE_ICON: Record<PhaseType, LucideIcon> = {
  research: FileSearch,
  plan: FileText,
  implement: Code,
  verify: FlaskConical,
};

// NOTE: `running` has no lucide icon — a spinning icon glyph renders warped
// at small sizes, so the running state draws a clean CSS ring spinner instead.
const STATUS_ICON: Record<Exclude<PhaseRunStatus, 'running'>, LucideIcon> = {
  completed: CheckCircle2,
  failed: XCircle,
};

const STATUS_COLOR: Record<Exclude<PhaseRunStatus, 'running'>, string> = {
  completed: 'text-emerald-400',
  failed: 'text-red-400',
};

export interface PhaseTabInfo {
  phaseType: PhaseType;
  /** Latest iteration's status — drives the tab's status glyph. `pending`
   * means the phase is planned (complexity staging) but hasn't run yet. */
  latestStatus: PhaseRunStatus | 'pending';
  iterationCount: number;
}

export interface PhaseTabBarProps {
  tabs: PhaseTabInfo[];
  selected: PhaseType;
  onSelect: (phase: PhaseType) => void;
}

/**
 * @param tabs - One entry per phase that has data / データのあるフェーズ一覧
 * @param selected - Currently selected phase / 選択中フェーズ
 * @param onSelect - Tab click handler / タブ選択ハンドラ
 */
export function PhaseTabBar({ tabs, selected, onSelect }: PhaseTabBarProps) {
  const t = useTranslations('phaseTimeline');
  return (
    <div role="tablist" className="flex items-stretch gap-0.5 overflow-x-auto px-1 pt-1">
      {tabs.map(({ phaseType, latestStatus, iterationCount }) => {
        const PhaseIcon = PHASE_ICON[phaseType];
        const active = phaseType === selected;
        const StatusIcon =
          latestStatus === 'running' || latestStatus === 'pending'
            ? null
            : STATUS_ICON[latestStatus];
        return (
          <button
            key={phaseType}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(phaseType)}
            className={`flex items-center gap-1.5 rounded-t-md border-x border-t px-3 py-1.5 text-xs font-medium transition-colors ${
              active
                ? 'border-zinc-700 bg-zinc-950 text-zinc-100'
                : 'border-transparent bg-zinc-800/60 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
            }`}
          >
            <PhaseIcon className="h-3.5 w-3.5" />
            {t(`phaseLabel.${phaseType}`)}
            {iterationCount > 1 && (
              <span className="rounded bg-zinc-700 px-1 text-[10px] text-zinc-200">
                {iterationCount}
              </span>
            )}
            {StatusIcon ? (
              <StatusIcon
                className={`h-3.5 w-3.5 ${STATUS_COLOR[latestStatus as Exclude<PhaseRunStatus, 'running'>]}`}
              />
            ) : latestStatus === 'pending' ? (
              // Planned but not started — hollow ring.
              <span
                aria-hidden
                className="h-3 w-3 shrink-0 rounded-full border-2 border-zinc-600"
              />
            ) : (
              <span
                aria-hidden
                className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-blue-400 border-t-transparent"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
