/**
 * ReviewHistoryItems
 *
 * Accordion rows for the two kinds of verification shown in the task's
 * quality-gate history: a MEASURED run (automated lint/type/test results) and
 * an independent JURY review (structured findings with severity and evidence;
 * in the two-reviewer form also the seats, the verifier's checks and a human
 * wait).
 * Kept visually distinct so "検証済み" is never read as "レビュー済み".
 * NOT responsible for fetching — CriticHistorySection owns that.
 */
'use client';

import { useTranslations } from 'next-intl';
import { formatDateTime } from '@/utils/date';
import { AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import type { JuryReviewEntry, MeasuredEntry } from './review-history';

import { CHIP, GOOD, BAD, WARN, NEUTRAL } from './review-chips';
import { JuryFindingRow, JurySeatsLine } from './JuryFindingRow';

const OUTCOME_CHIPS: Record<MeasuredEntry['outcome'], string> = {
  pass: GOOD,
  fail: BAD,
  unverifiable: WARN,
};

const VERDICT_CHIPS: Record<JuryReviewEntry['verdict'], string> = {
  pass: GOOD,
  fail: BAD,
  unknown: NEUTRAL,
  hold: WARN,
};

/**
 * One measured verification run.
 *
 * @param entry - Measured run to show / 表示する実測
 * @returns Accordion row / アコーディオン行
 */
export function MeasuredHistoryItem({ entry }: { entry: MeasuredEntry }) {
  const t = useTranslations('workflow');
  const k = 'taskWorkflowSection.criticHistory.measured';
  return (
    <AccordionItem id={entry.id}>
      <AccordionTrigger
        id={entry.id}
        badge={
          <span className={`${CHIP} ${OUTCOME_CHIPS[entry.outcome]}`}>
            {t(`${k}.outcome.${entry.outcome}`)}
          </span>
        }
      >
        {t(`${k}.entryLabel`, { date: entry.createdAt ? formatDateTime(entry.createdAt) : '' })}
      </AccordionTrigger>
      <AccordionContent id={entry.id}>
        <ul className="space-y-1 text-sm text-zinc-600 dark:text-zinc-300">
          {entry.checks.map((c) => (
            <li key={c.name} className="flex items-baseline gap-2">
              <span className="w-24 shrink-0 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                {c.name}
              </span>
              <span>{t(`${k}.check.${c.status}`, { count: c.errorCount })}</span>
            </li>
          ))}
        </ul>
      </AccordionContent>
    </AccordionItem>
  );
}

/**
 * One independent jury review.
 *
 * @param entry - Jury review to show / 表示する陪審の判定
 * @returns Accordion row / アコーディオン行
 */
export function JuryReviewHistoryItem({ entry }: { entry: JuryReviewEntry }) {
  const t = useTranslations('workflow');
  const k = 'taskWorkflowSection.criticHistory.jury';
  return (
    <AccordionItem id={entry.id}>
      <AccordionTrigger
        id={entry.id}
        badge={
          <span className="flex items-center gap-1.5">
            <span className={`${CHIP} ${VERDICT_CHIPS[entry.verdict]}`}>
              {t(`${k}.verdict.${entry.verdict}`)}
            </span>
            {entry.findings.length > 0 && (
              <span className={`${CHIP} ${NEUTRAL}`}>
                {t(`${k}.findingsCount`, { count: entry.findings.length })}
              </span>
            )}
          </span>
        }
      >
        {t(entry.form === 'two_seat' ? `${k}.entryLabelTwoSeat` : `${k}.entryLabel`, {
          date: entry.createdAt ? formatDateTime(entry.createdAt) : '',
          judged: entry.judgedCount,
          total: entry.jurorCount,
        })}
      </AccordionTrigger>
      <AccordionContent id={entry.id}>
        {entry.awaitingHuman && (
          <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
            {t(`${k}.awaiting.${entry.awaitingHuman.reason}`)}
            {entry.awaitingHuman.detail ? `: ${entry.awaitingHuman.detail}` : ''}
          </p>
        )}
        <JurySeatsLine seats={entry.seats} />
        {entry.findings.length > 0 ? (
          <ul className="space-y-3">
            {entry.findings.map((f, i) => (
              <JuryFindingRow key={i} f={f} />
            ))}
          </ul>
        ) : entry.legacyReasons.length > 0 ? (
          <ul className="list-disc list-outside space-y-1.5 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
            {entry.legacyReasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t(`${k}.noFindings`)}</p>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}
