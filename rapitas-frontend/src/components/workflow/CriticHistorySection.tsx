/**
 * CriticHistorySection
 *
 * Renders the persistent, collapsible audit log of quality-critic gate
 * events (research/plan bounces and budget-exhausted pass-throughs) inside
 * the task-detail workflow card, together with the verify-phase record kept
 * in two visibly separate groups: MEASURED runs (検証済み — real lint/type/test
 * results) and the independent JURY review (レビュー済み — findings with
 * severity and evidence; in the two-reviewer form also the seats, the
 * verifier's checks and a review hold awaiting a human, with its resolutions).
 * NOT responsible for the transient "being regenerated" banner — that stays
 * in TaskWorkflowSection.
 */
'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { formatDateTime } from '@/utils/date';
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
import {
  deriveJuryReviewHistory,
  deriveMeasuredHistory,
  deriveReviewHoldResolutions,
  type JuryReviewEntry,
  type MeasuredEntry,
  type RawTimelineEvent,
  type ReviewHoldResolutionEntry,
} from './review-history';
import { JuryReviewHistoryItem, MeasuredHistoryItem } from './ReviewHistoryItems';
import ReviewHoldPanel from './ReviewHoldPanel';

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

/** Task-scoped timeline events of one type (the API returns newest first). */
async function fetchTaskEvents(taskId: number, eventType: string): Promise<RawTimelineEvent[]> {
  try {
    const q = new URLSearchParams({ eventType, correlationId: `task-${taskId}`, limit: '20' });
    const res = await fetch(`${API_BASE_URL}/memory/timeline?${q.toString()}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { events?: RawTimelineEvent[] };
    return Array.isArray(data.events) ? data.events : [];
  } catch {
    return [];
  }
}

function GroupHeading({ label }: { label: string }) {
  return (
    <p className="px-4 pt-3 pb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
  );
}

/**
 * Collapsible chronological list of critic-gate events, measured
 * verification runs and jury reviews for one task. Fetches once per taskId
 * and renders nothing when the task has none of them.
 *
 * @param taskId - Task whose transition log to display / 対象タスクのID
 * @returns The history card, or null when there is nothing to show / 履歴カード（該当なしは null）
 */
export default function CriticHistorySection({ taskId }: CriticHistorySectionProps) {
  const t = useTranslations('workflow');
  const [entries, setEntries] = useState<CriticGateHistoryEntry[]>([]);
  const [measured, setMeasured] = useState<MeasuredEntry[]>([]);
  const [jury, setJury] = useState<JuryReviewEntry[]>([]);
  const [resolutions, setResolutions] = useState<ReviewHoldResolutionEntry[]>([]);
  // Bumped after a hold is resolved so the history shows the resolution.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!taskId) {
      setEntries([]);
      setMeasured([]);
      setJury([]);
      setResolutions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const [measuredEvents, juryEvents, resolvedEvents] = await Promise.all([
        fetchTaskEvents(taskId, 'verification_measured'),
        fetchTaskEvents(taskId, 'adversarial_review'),
        fetchTaskEvents(taskId, 'review_hold_resolved'),
      ]);
      if (!cancelled) {
        setMeasured(deriveMeasuredHistory(measuredEvents));
        setJury(deriveJuryReviewHistory(juryEvents));
        setResolutions(deriveReviewHoldResolutions(resolvedEvents));
      }
    })();
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
  }, [taskId, reloadKey]);

  const holdPanel = (
    <ReviewHoldPanel taskId={taskId} onResolved={() => setReloadKey((n) => n + 1)} />
  );
  const total = entries.length + measured.length + jury.length;
  // A hold always has a review behind it, but the panel must not depend on
  // the history fetch having succeeded.
  if (total === 0) return holdPanel;
  // The critic list keeps its old look when it is the only thing to show.
  const showCriticHeading = entries.length > 0 && measured.length + jury.length > 0;

  return (
    <div className="px-4 pb-4">
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('taskWorkflowSection.criticHistory.title')}
          </p>
          <span className="shrink-0 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
            {measured.length + jury.length > 0
              ? t('taskWorkflowSection.criticHistory.recordsCount', { count: total })
              : t('taskWorkflowSection.criticHistory.reasonsCount', { count: total })}
          </span>
        </div>
        {holdPanel}
        {showCriticHeading && (
          <GroupHeading label={t('taskWorkflowSection.criticHistory.groups.critic')} />
        )}
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
                    date: entry.createdAt ? formatDateTime(entry.createdAt) : '',
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
        {measured.length > 0 && (
          <>
            <GroupHeading label={t('taskWorkflowSection.criticHistory.groups.measured')} />
            <Accordion allowMultiple>
              {measured.map((m) => (
                <MeasuredHistoryItem key={m.id} entry={m} />
              ))}
            </Accordion>
          </>
        )}
        {jury.length > 0 && (
          <>
            <GroupHeading label={t('taskWorkflowSection.criticHistory.groups.jury')} />
            <Accordion allowMultiple>
              {jury.map((j) => (
                <JuryReviewHistoryItem key={j.id} entry={j} />
              ))}
            </Accordion>
            {resolutions.map((r) => (
              <p key={r.id} className="px-4 py-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                {t('taskWorkflowSection.criticHistory.reviewHold.resolved', {
                  action: t(`taskWorkflowSection.criticHistory.reviewHold.action.${r.action}`),
                  by: r.resolvedBy ?? '',
                  date: r.createdAt ? formatDateTime(r.createdAt) : '',
                })}
                {r.note ? ` — ${r.note}` : ''}
              </p>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
