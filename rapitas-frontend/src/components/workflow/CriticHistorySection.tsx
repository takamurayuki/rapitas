/**
 * CriticHistorySection
 *
 * Renders the persistent, collapsible audit log of quality-critic gate
 * events (research/plan bounces and budget-exhausted pass-throughs) inside
 * the task-detail workflow card. NOT responsible for the transient "being
 * regenerated" banner — that stays in TaskWorkflowSection.
 */
'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { formatDate } from '@/utils/date';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import {
  deriveCriticGateHistory,
  severityBucket,
  type CriticGateHistoryEntry,
  type RawWorkflowTransition,
} from './critic-history';

export interface CriticHistorySectionProps {
  taskId: number;
}

// Same visual tiers as TaskWorkflowSection's severityStyle() so the history
// reads consistently with the transient rejection banner above it.
const SEVERITY_CHIPS: Record<'high' | 'medium' | 'low', string> = {
  high: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  low: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
};

const TYPE_CHIPS: Record<CriticGateHistoryEntry['type'], string> = {
  bounced: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  exhausted: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
};

/**
 * Collapsible chronological list of critic-gate events for one task.
 * Fetches the transition log once per taskId and renders nothing when the
 * task has no critic-gate transitions.
 *
 * @param taskId - Task whose transition log to display / 対象タスクのID
 * @returns The history card, or null when there is nothing to show / 履歴カード（該当なしは null）
 */
export default function CriticHistorySection({ taskId }: CriticHistorySectionProps) {
  const t = useTranslations('workflow');
  const [entries, setEntries] = useState<CriticGateHistoryEntry[]>([]);

  useEffect(() => {
    if (!taskId) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/workflow/tasks/${taskId}/transitions`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          success?: boolean;
          transitions?: RawWorkflowTransition[];
        };
        if (cancelled || !data.success || !data.transitions?.length) return;
        setEntries(deriveCriticGateHistory(data.transitions));
      } catch {
        // Non-fatal — this is auxiliary audit info; the section simply doesn't show.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  if (entries.length === 0) return null;

  return (
    <div className="px-4 pb-4">
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('taskWorkflowSection.criticHistory.title')}
          </p>
          <span className="shrink-0 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
            {t('taskWorkflowSection.criticHistory.reasonsCount', { count: entries.length })}
          </span>
        </div>
        <Accordion allowMultiple>
          {entries.map((entry) => {
            const bucket = severityBucket(entry.severity);
            return (
              <AccordionItem key={entry.id} id={entry.id}>
                <AccordionTrigger
                  id={entry.id}
                  badge={
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_CHIPS[entry.type]}`}
                      >
                        {t(`taskWorkflowSection.criticHistory.type.${entry.type}`)}
                      </span>
                      {bucket && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_CHIPS[bucket]}`}
                        >
                          {t(`taskWorkflowSection.criticHistory.severity.${bucket}`)}
                          {entry.severity != null ? ` (${entry.severity})` : ''}
                        </span>
                      )}
                    </span>
                  }
                >
                  {t('taskWorkflowSection.criticHistory.entryLabel', {
                    phase: t(`taskWorkflowSection.criticHistory.phase.${entry.phase}`),
                    date: entry.createdAt ? formatDate(entry.createdAt, 'long') : '',
                  })}
                </AccordionTrigger>
                <AccordionContent id={entry.id}>
                  {entry.reasons.length > 0 ? (
                    <ul className="list-disc list-outside space-y-1.5 pl-5 text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
                      {entry.reasons.map((reason, i) => (
                        <li key={i}>{reason}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      {t('taskWorkflowSection.criticHistory.noReasons')}
                    </p>
                  )}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </div>
    </div>
  );
}
