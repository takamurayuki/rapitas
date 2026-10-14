'use client';

/**
 * DeviationItem
 *
 * One colour-coded deviation row: 計画外 (red, warning) or 計画にあるが未実行
 * (amber, caution). In-plan / pending / skipped entries render nothing — the
 * timeline shows deviations only (task #1218 AC2).
 */

import { useTranslations } from 'next-intl';
import type { DeviationEntry } from './deviation-timeline.types';

const CATEGORY_CLASSES: Record<'out_of_plan' | 'planned_not_executed', string> = {
  out_of_plan:
    'border-red-300 bg-red-50 text-red-800 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200',
  planned_not_executed:
    'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200',
};

export interface DeviationItemProps {
  entry: DeviationEntry;
  /** Called when a deviation that has a log line is clicked. */
  onSelect?: (entry: DeviationEntry) => void;
}

/**
 * @param entry - Classified timeline entry / 分類済みエントリ
 * @param onSelect - Click handler for entries with a log line / ログ行を持つ逸脱のクリック処理
 */
export function DeviationItem({ entry, onSelect }: DeviationItemProps) {
  const t = useTranslations('deviationTimeline');
  if (entry.category !== 'out_of_plan' && entry.category !== 'planned_not_executed') return null;

  const time = entry.occurredAt ? new Date(entry.occurredAt).toLocaleTimeString() : null;
  const className = `flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left text-xs ${CATEGORY_CLASSES[entry.category]}`;
  const body = (
    <>
      <span className="shrink-0 rounded px-1 font-semibold">{t(`category.${entry.category}`)}</span>
      <span className="shrink-0 opacity-75">{t(`kind.${entry.kind}`)}</span>
      <span className="min-w-0 flex-1 break-all font-mono">{entry.display}</span>
      {time && <span className="shrink-0 tabular-nums opacity-60">{time}</span>}
    </>
  );

  if (onSelect && entry.logSequence !== undefined) {
    return (
      <button
        type="button"
        data-testid="deviation-item"
        data-category={entry.category}
        className={`${className} hover:brightness-95 dark:hover:brightness-125`}
        title={t('clickHint')}
        onClick={() => onSelect(entry)}
      >
        {body}
      </button>
    );
  }
  return (
    <div data-testid="deviation-item" data-category={entry.category} className={className}>
      {body}
    </div>
  );
}
