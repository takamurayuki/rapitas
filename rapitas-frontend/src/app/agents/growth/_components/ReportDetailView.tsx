'use client';

/**
 * ReportDetailView
 *
 * Detail pane of the /agents/growth archive: counts strip, satiation banner,
 * and the report markdown (AI-polished or plain aggregate). Fetching is done
 * by the parent GrowthClient — this component only renders.
 */

import { useTranslations } from 'next-intl';
import { PauseCircle } from 'lucide-react';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import type { ReportDetail } from './growth-types';

/** Count tile definitions: i18n key + value picker. */
const COUNT_KEYS = [
  'completed',
  'mergedPrs',
  'concerns',
  'decisions',
  'restarts',
  'interventions',
] as const;

interface Props {
  report: ReportDetail;
}

export default function ReportDetailView({ report }: Props) {
  const t = useTranslations('agents');

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          {t('growthReportHeading', { date: report.date })}
        </h2>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            report.aiFormatted
              ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300'
              : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
          }`}
        >
          {report.aiFormatted ? t('growthAiBadge') : t('growthPlainBadge')}
        </span>
        {report.satiated && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:bg-amber-900/30 dark:text-amber-300">
            {t('growthSatiatedBadge')}
          </span>
        )}
      </div>

      {report.counts && (
        <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {COUNT_KEYS.map((key) => (
            <div
              key={key}
              className="rounded-lg border border-zinc-100 bg-zinc-50 px-2 py-2 text-center dark:border-zinc-800 dark:bg-zinc-800/60"
            >
              <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {report.counts?.[key] ?? 0}
              </div>
              <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
                {t(`growthCount_${key}`)}
              </div>
            </div>
          ))}
        </div>
      )}

      {report.satiated && report.satiatedReason && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          <PauseCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-medium">{t('growthSatiatedReasonTitle')}</div>
            <p className="mt-0.5">{report.satiatedReason}</p>
          </div>
        </div>
      )}

      {report.reportMarkdown ? (
        <MarkdownView content={report.reportMarkdown} />
      ) : (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{report.summary}</p>
      )}
    </div>
  );
}
