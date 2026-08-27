'use client';
/**
 * ErrorDiagnosisPanel
 *
 * Read-only list of LLM-assisted diagnoses of unclassified provider errors
 * (root cause, confidence, suggested action) from GET /agents/error-diagnosis,
 * plus a summary and per-row helpful/not-helpful feedback buttons. Not
 * responsible for producing diagnoses or acting on suggestions — display and
 * feedback collection only.
 */
import { useState } from 'react';
import { Stethoscope, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useErrorDiagnosis, type DiagnosisRecord } from './use-error-diagnosis';
import type { PanelMeta } from './panel-types';

/** Registered with scripts/generate-agents-panels.mjs — see panel-types.ts. */
export const panelMeta: PanelMeta = { id: 'error-diagnosis', order: 20 };

const LOW_CONFIDENCE_THRESHOLD = 50;

/** Render 60.4 → "60%" (integer confidence, no decimals). */
function formatConfidence(confidence: number): string {
  return `${Math.round(confidence)}%`;
}

/** Render 0.6 → "60%" (one decimal only when informative). */
function formatRate(rate: number): string {
  const pct = rate * 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}

function DiagnosisRow({
  diagnosis,
  lowConfidenceLabel,
  pending,
  onFeedback,
}: {
  diagnosis: DiagnosisRecord;
  lowConfidenceLabel: string;
  pending: boolean;
  onFeedback: (id: string, helpful: boolean) => void;
}) {
  const isLowConfidence = diagnosis.confidence < LOW_CONFIDENCE_THRESHOLD;
  const feedbackDisabled = diagnosis.feedback !== null || pending;
  return (
    <tr className="border-t border-zinc-100 dark:border-zinc-700">
      <td className="px-4 py-2 text-xs text-zinc-700 dark:text-zinc-300">{diagnosis.rootCause}</td>
      <td className="px-4 py-2 text-right text-zinc-900 dark:text-zinc-100">
        {formatConfidence(diagnosis.confidence)}
        {isLowConfidence && (
          <span className="ml-2 inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
            {lowConfidenceLabel}
          </span>
        )}
      </td>
      <td className="px-4 py-2 font-mono text-xs text-zinc-700 dark:text-zinc-300">
        {diagnosis.suggestedAction}
      </td>
      <td className="px-4 py-2 text-right">
        <div className="inline-flex items-center gap-1">
          <button
            type="button"
            aria-label="helpful"
            disabled={feedbackDisabled}
            onClick={() => onFeedback(diagnosis.id, true)}
            className={`rounded p-1 ${
              diagnosis.feedback === 'helpful'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-zinc-400 hover:text-emerald-600 disabled:hover:text-zinc-400 dark:text-zinc-500 dark:hover:text-emerald-400'
            }`}
          >
            <ThumbsUp className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="not helpful"
            disabled={feedbackDisabled}
            onClick={() => onFeedback(diagnosis.id, false)}
            className={`rounded p-1 ${
              diagnosis.feedback === 'not_helpful'
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-zinc-400 hover:text-rose-600 disabled:hover:text-zinc-400 dark:text-zinc-500 dark:hover:text-rose-400'
            }`}
          >
            <ThumbsDown className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </td>
    </tr>
  );
}

export function ErrorDiagnosisPanel() {
  const t = useTranslations('agents');
  const { data, loading, error, submitFeedback } = useErrorDiagnosis();
  const [pendingId, setPendingId] = useState<string | null>(null);

  // Same convention as RecoveryMetricsPanel: render nothing until the first
  // response settles to avoid a flash of the empty/error state.
  if (loading) return null;

  const handleFeedback = (id: string, helpful: boolean) => {
    setPendingId(id);
    submitFeedback(id, helpful).finally(() =>
      setPendingId((current) => (current === id ? null : current)),
    );
  };

  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center gap-2">
        <Stethoscope className="h-4 w-4 text-zinc-400 dark:text-zinc-500" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          {t('errorDiagnosis.title')}
        </h3>
        {data && (
          <span className="text-xs text-zinc-400 dark:text-zinc-500">
            {t('errorDiagnosis.window', { days: data.windowDays })}
          </span>
        )}
        {data && data.summary.total > 0 && (
          <span className="text-xs text-zinc-400 dark:text-zinc-500">
            {t('errorDiagnosis.summary', {
              total: data.summary.total,
              avgConfidence: formatConfidence(data.summary.avgConfidence),
              feedbackRate: formatRate(data.summary.feedbackRate),
              helpfulRate: formatRate(data.summary.helpfulRate),
            })}
          </span>
        )}
      </div>
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800">
        {error || !data ? (
          <p className="px-4 py-6 text-sm text-zinc-500 dark:text-zinc-400">
            {t('errorDiagnosis.loadFailed')}
          </p>
        ) : data.diagnoses.length === 0 ? (
          <p className="px-4 py-6 text-sm text-zinc-500 dark:text-zinc-400">
            {t('errorDiagnosis.empty')}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400">
                <th className="px-4 py-2 font-medium">{t('errorDiagnosis.rootCause')}</th>
                <th className="px-4 py-2 text-right font-medium">
                  {t('errorDiagnosis.confidence')}
                </th>
                <th className="px-4 py-2 font-medium">{t('errorDiagnosis.suggestedAction')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('errorDiagnosis.feedback')}</th>
              </tr>
            </thead>
            <tbody>
              {data.diagnoses.map((diagnosis) => (
                <DiagnosisRow
                  key={diagnosis.id}
                  diagnosis={diagnosis}
                  lowConfidenceLabel={t('errorDiagnosis.lowConfidence')}
                  pending={pendingId === diagnosis.id}
                  onFeedback={handleFeedback}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default ErrorDiagnosisPanel;
