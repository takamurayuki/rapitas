'use client';
/**
 * triage-item-card
 *
 * Shows the current decision item with kind, summary and impact first, so the
 * information needed to decide is available in reading (and listening) order.
 * Not responsible for key handling or committing the decision.
 */

import { useTranslations } from 'next-intl';
import { describeTriageItem, type TriageItem } from '../_lib/triage-rules';

interface TriageItemCardProps {
  item: TriageItem;
}

/**
 * Render one item; the heading block is kind -> summary -> impact.
 */
export function TriageItemCard({ item }: TriageItemCardProps) {
  const t = useTranslations('triage');
  const d = describeTriageItem(item);

  const kindLabel = t.has(`kinds.${item.requestType}`)
    ? t(`kinds.${item.requestType}`)
    : item.requestType;

  const impactParts: string[] = [];
  if (d.impact.subtasks !== null)
    impactParts.push(t('impactSubtasks', { count: d.impact.subtasks }));
  if (d.impact.files !== null) impactParts.push(t('impactFiles', { count: d.impact.files }));
  const impactText = impactParts.length > 0 ? impactParts.join(' / ') : t('impactUnknown');

  const amountText = d.amount === null ? t('amountUnknown') : `${d.amount.toLocaleString()} JPY`;

  return (
    <article
      aria-label={item.title}
      className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-6"
    >
      <dl className="space-y-4">
        <div>
          <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t('kind')}</dt>
          <dd className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{kindLabel}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t('summary')}</dt>
          <dd className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{item.title}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t('impact')}</dt>
          <dd className="text-base text-zinc-800 dark:text-zinc-200">{impactText}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t('amount')}</dt>
          <dd className="text-base text-zinc-800 dark:text-zinc-200">{amountText}</dd>
        </div>
      </dl>
    </article>
  );
}
