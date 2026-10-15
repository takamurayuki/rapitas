'use client';

/**
 * DeviationTimeline
 *
 * Plan-vs-execution deviation view (task #1218). Lists only the deviations
 * (計画外 / 計画にあるが未実行) in chronological order, opens the surrounding
 * log on click, and records the reviewer's decision + comment as an audit
 * record. An ambiguous plan (no file patterns) shows a warning instead of any
 * judgement.
 */

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { TriangleAlert, Waypoints } from 'lucide-react';
import Pagination from '@/components/ui/pagination/Pagination';
import { DeviationItem } from './DeviationItem';
import { DeviationContextDialog } from './DeviationContextDialog';
import { useDeviationTimeline } from './useDeviationTimeline';
import type { DeviationDecision, DeviationEntry } from './deviation-timeline.types';

/** Paginate once the deviation list grows past this many rows. */
const PAGINATE_THRESHOLD = 10;

export interface DeviationTimelineProps {
  taskId: number;
}

/**
 * @param taskId - Task whose latest execution is compared with its plan / タスクID
 */
export function DeviationTimeline({ taskId }: DeviationTimelineProps) {
  const t = useTranslations('deviationTimeline');
  const { timeline, loading, error, fetchContext, submitAudit, submitting, submitError } =
    useDeviationTimeline(taskId);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(PAGINATE_THRESHOLD);
  const [selected, setSelected] = useState<DeviationEntry | null>(null);
  const [comment, setComment] = useState('');
  const [saved, setSaved] = useState(false);

  // Server entries are already chronological; filtering keeps that order.
  const deviations = useMemo(
    () =>
      (timeline?.entries ?? []).filter(
        (e) => e.category === 'out_of_plan' || e.category === 'planned_not_executed',
      ),
    [timeline],
  );
  const totalPages = Math.max(1, Math.ceil(deviations.length / itemsPerPage));
  const visible =
    deviations.length > PAGINATE_THRESHOLD
      ? deviations.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
      : deviations;

  const handleDecision = async (decision: DeviationDecision) => {
    setSaved(false);
    if (await submitAudit(decision, comment)) setSaved(true);
  };

  if (loading) return null;

  return (
    <section className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
      <header className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-100">
        <Waypoints className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
        <span>{t('title')}</span>
      </header>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{t('loadError')}</p>}

      {timeline?.status === 'ambiguous' && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">{t('ambiguous')}</p>
            <p>{t('ambiguousHint')}</p>
          </div>
        </div>
      )}

      {timeline?.status === 'no_operations' && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('noOperations')}</p>
      )}
      {timeline?.status === 'unsupported_provider' && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('unsupportedProvider')}</p>
      )}

      {timeline?.status === 'ok' && timeline.counts && (
        <>
          <div className="flex flex-wrap gap-3 text-xs">
            <span className="text-red-700 dark:text-red-300">
              {t('counts.outOfPlan', { n: timeline.counts.outOfPlan })}
            </span>
            <span className="text-amber-700 dark:text-amber-300">
              {t('counts.plannedNotExecuted', { n: timeline.counts.plannedNotExecuted })}
            </span>
            <span className="text-zinc-500 dark:text-zinc-400">
              {t('counts.inPlan', { n: timeline.counts.inPlan })}
            </span>
          </div>
          {deviations.length === 0 ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('noDeviations')}</p>
          ) : (
            <div className="space-y-1">
              {visible.map((entry, i) => (
                <DeviationItem
                  key={`${entry.seq ?? 'd'}-${entry.declaredItem ?? ''}-${i}`}
                  entry={entry}
                  onSelect={timeline.executionId ? setSelected : undefined}
                />
              ))}
            </div>
          )}
          {deviations.length > PAGINATE_THRESHOLD && (
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              itemsPerPage={itemsPerPage}
              onPageChange={setCurrentPage}
              onItemsPerPageChange={(n) => {
                setItemsPerPage(n);
                setCurrentPage(1);
              }}
            />
          )}
        </>
      )}

      {timeline && timeline.warnings.length > 0 && (
        <ul className="list-disc pl-4 text-[11px] text-zinc-500 dark:text-zinc-400">
          {timeline.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {timeline && (
        <div className="space-y-1 border-t border-zinc-200 pt-2 dark:border-zinc-700">
          <label
            htmlFor={`deviation-comment-${taskId}`}
            className="text-xs text-zinc-600 dark:text-zinc-300"
          >
            {t('commentLabel')}
          </label>
          <textarea
            id={`deviation-comment-${taskId}`}
            aria-label={t('commentLabel')}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t('commentPlaceholder')}
            rows={2}
            className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-800 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleDecision('approved')}
              className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400"
            >
              {submitting ? t('submitting') : t('approve')}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleDecision('rejected')}
              className="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {t('reject')}
            </button>
            {saved && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400">{t('saved')}</span>
            )}
            {submitError && (
              <span className="text-xs text-red-600 dark:text-red-400">{t('saveError')}</span>
            )}
          </div>
        </div>
      )}

      <DeviationContextDialog
        open={selected !== null}
        executionId={timeline?.executionId ?? null}
        seq={selected?.logSequence ?? null}
        fetchContext={fetchContext}
        onClose={() => setSelected(null)}
      />
    </section>
  );
}
