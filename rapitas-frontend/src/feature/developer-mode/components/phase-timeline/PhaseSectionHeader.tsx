'use client';

/**
 * phase-timeline/PhaseSectionHeader
 *
 * Clickable, sticky header for one phase-timeline section (task #785).
 * `sticky top-0` inside the shared scrollable PhaseTimeline container means
 * whichever section is currently being scrolled through keeps its own
 * header pinned to the top — no separate rail/tabs component needed (see
 * research.md 前提監査 — the operator explicitly rejected a phase rail).
 */

import {
  FileSearch,
  FileText,
  Code,
  FlaskConical,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
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

const STATUS_ICON: Record<PhaseRunStatus, LucideIcon> = {
  running: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
};

const STATUS_COLOR: Record<PhaseRunStatus, string> = {
  running: 'text-blue-500 dark:text-blue-400',
  completed: 'text-green-500 dark:text-green-400',
  failed: 'text-red-500 dark:text-red-400',
};

export interface PhaseSectionHeaderProps {
  phaseType: PhaseType;
  iterationNumber: number;
  totalIterations: number;
  status: PhaseRunStatus;
  /** Pre-formatted 1-line summary (e.g. "✓ 1m23s (42行)") shown when collapsed; null while running with nothing to summarize yet. */
  summaryText: string | null;
  expanded: boolean;
  onToggle: () => void;
  boundaryUncertain: boolean;
}

/**
 * @param phaseType - Which of the four timeline phases this section belongs to / フェーズ種別
 * @param iterationNumber - 1-based repair-loop iteration number / 反復番号
 * @param totalIterations - Total iterations this phase has so far — the "(N回目)" suffix only shows when > 1 / フェーズの総反復数
 * @param status - Current run status of this iteration / 実行状態
 * @param summaryText - Collapsed-state 1-line summary, or null / 折りたたみ時の要約
 * @param expanded - Whether this section's body is currently shown / 展開状態
 * @param onToggle - Click handler toggling expand/collapse / 開閉トグル
 * @param boundaryUncertain - Whether the phase boundary could not be confirmed (task #785 plan.md エッジケース) / フェーズ境界の不確実性
 */
export function PhaseSectionHeader({
  phaseType,
  iterationNumber,
  totalIterations,
  status,
  summaryText,
  expanded,
  onToggle,
  boundaryUncertain,
}: PhaseSectionHeaderProps) {
  const t = useTranslations('phaseTimeline');
  const PhaseIcon = PHASE_ICON[phaseType];
  const StatusIcon = STATUS_ICON[status];
  const title =
    totalIterations > 1
      ? t('sectionTitleIteration', { phase: t(`phaseLabel.${phaseType}`), n: iterationNumber })
      : t('sectionTitle', { phase: t(`phaseLabel.${phaseType}`) });

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={expanded ? t('collapseAria') : t('expandAria')}
      className="sticky top-0 z-10 flex w-full items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-3 py-1.5 text-left dark:border-zinc-800 dark:bg-zinc-900"
    >
      {expanded ? (
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
      ) : (
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
      )}
      <PhaseIcon className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
      <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">{title}</span>
      {boundaryUncertain && (
        <AlertTriangle
          className="h-3.5 w-3.5 shrink-0 text-amber-500"
          aria-label={t('boundaryUncertain')}
        />
      )}
      <span className="ml-auto flex items-center gap-1.5">
        {!expanded && summaryText && (
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{summaryText}</span>
        )}
        <StatusIcon
          className={`h-3.5 w-3.5 shrink-0 ${STATUS_COLOR[status]} ${status === 'running' ? 'animate-spin' : ''}`}
        />
      </span>
    </button>
  );
}
