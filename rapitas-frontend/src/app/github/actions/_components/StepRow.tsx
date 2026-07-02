'use client';

/**
 * StepRow
 *
 * A single step (grandchild) within a job. Expands to reveal that step's log
 * section with a copy button. Presentational: the parent job owns log fetching
 * and passes the matching section plus expand/loading state in.
 */

import { ChevronRight, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { StatusIcon } from './StatusIcon';
import { LogViewer } from './LogViewer';
import type { RunStep, JobLogSection } from '../_types/actions.types';

interface StepRowProps {
  step: RunStep;
  isExpanded: boolean;
  /** True while the job's log is being fetched for this step. / ログ読込中 */
  isLoadingLog: boolean;
  /** The matching log section, once loaded. / 対応するログセクション */
  section: JobLogSection | undefined;
  onToggle: () => void;
}

/**
 * Render one expandable step row with its log section.
 *
 * @param props - step data, the matched section, and expand/loading state / ステップと展開状態
 */
export function StepRow({ step, isExpanded, isLoadingLog, section, onToggle }: StepRowProps) {
  const t = useTranslations('github');
  return (
    <div>
      <button onClick={onToggle} className="flex w-full items-center gap-2 py-0.5 text-left">
        {isLoadingLog ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-zinc-400" />
        ) : (
          <ChevronRight
            className={`h-3 w-3 shrink-0 text-zinc-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          />
        )}
        <StatusIcon status={step.status} conclusion={step.conclusion} className="h-3.5 w-3.5" />
        <span className="truncate text-[11px] text-zinc-600 dark:text-zinc-300">{step.name}</span>
      </button>
      {isExpanded && (
        <div className="mt-1 pl-5">
          {section ? (
            <LogViewer log={section.log || t('stepRow.noLogPlaceholder')} />
          ) : (
            <p className="text-[11px] text-zinc-400">{t('stepRow.logNotFound')}</p>
          )}
        </div>
      )}
    </div>
  );
}
