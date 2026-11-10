/**
 * ReviewHistoryItems
 *
 * Accordion rows for the two kinds of verification shown in the task's
 * quality-gate history: a MEASURED run (automated lint/type/test results) and
 * an independent JURY review (structured findings with severity and evidence).
 * Kept visually distinct so "検証済み" is never read as "レビュー済み".
 * NOT responsible for fetching — CriticHistorySection owns that.
 */
'use client';

import { useTranslations } from 'next-intl';
import { formatDateTime } from '@/utils/date';
import { AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import type { DisplayFinding, JuryReviewEntry, MeasuredEntry } from './review-history';

const CHIP = 'rounded-full px-2 py-0.5 text-xs font-medium';
const GOOD = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
const BAD = 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300';
const WARN = 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
const NEUTRAL = 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300';

// Same tiers as the critic severity chips (high / medium / low).
const FINDING_CHIPS: Record<DisplayFinding['severity'], string> = {
  blocker: BAD,
  major: WARN,
  minor: NEUTRAL,
};

const OUTCOME_CHIPS: Record<MeasuredEntry['outcome'], string> = {
  pass: GOOD,
  fail: BAD,
  unverifiable: WARN,
};

const VERDICT_CHIPS: Record<JuryReviewEntry['verdict'], string> = {
  pass: GOOD,
  fail: BAD,
  unknown: NEUTRAL,
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

function FindingRow({ f }: { f: DisplayFinding }) {
  const t = useTranslations('workflow');
  const k = 'taskWorkflowSection.criticHistory.jury';
  return (
    <li className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`${CHIP} ${FINDING_CHIPS[f.severity]}`}>
          {t(`${k}.severity.${f.severity}`)}
        </span>
        {f.needsCheck && <span className={`${CHIP} ${NEUTRAL}`}>{t(`${k}.needsCheck`)}</span>}
        {f.criterion && <span className="text-xs text-zinc-500">{f.criterion}</span>}
        <span className="text-sm text-zinc-700 dark:text-zinc-200">{f.summary}</span>
      </div>
      {f.evidence && (
        <p className="pl-1 text-xs text-zinc-500 dark:text-zinc-400">
          {t(`${k}.evidence`)}: <span className="font-mono break-all">{f.evidence}</span>
        </p>
      )}
      {f.repro && (
        <p className="pl-1 text-xs text-zinc-500 dark:text-zinc-400">
          {t(`${k}.repro`)}: {f.repro}
        </p>
      )}
      {f.juror && (
        <p className="pl-1 text-xs text-zinc-400 dark:text-zinc-500">
          {t(`${k}.juror`)}: {f.juror}
        </p>
      )}
    </li>
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
        {t(`${k}.entryLabel`, {
          date: entry.createdAt ? formatDateTime(entry.createdAt) : '',
          judged: entry.judgedCount,
          total: entry.jurorCount,
        })}
      </AccordionTrigger>
      <AccordionContent id={entry.id}>
        {entry.findings.length > 0 ? (
          <ul className="space-y-3">
            {entry.findings.map((f, i) => (
              <FindingRow key={i} f={f} />
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
