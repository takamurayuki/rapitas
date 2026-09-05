'use client';
/**
 * ResourceContentionPanel
 *
 * Read/act surface for the resource-contention gate (task 725):
 * enabled flag, current host CPU usage vs threshold, effective concurrency,
 * a table of recent selection deferrals, and a per-theme "今すぐ実行" manual
 * override. Not responsible for the gate decision itself (backend-only) — see
 * services/workflow/auto-run/resource-contention-gate.ts.
 */
import { useState } from 'react';
import { Thermometer } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useResourceGate, type ResourceGateDeferral } from './use-resource-gate';
import type { PanelMeta } from './panel-types';
import { formatDateTime } from '@/utils/date';

/** Registered with scripts/generate-agents-panels.mjs — see panel-types.ts. */
export const panelMeta: PanelMeta = { id: 'resource-contention', order: 40 };

/** Render 92.4 → "92%" (integer percentage, no decimals). */
function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function DeferralRow({
  deferral,
  runNowLabel,
  onRunNow,
  pending,
}: {
  deferral: ResourceGateDeferral;
  runNowLabel: string;
  onRunNow: (themeId: number) => void;
  pending: boolean;
}) {
  return (
    <tr className="border-t border-zinc-100 dark:border-zinc-700">
      <td className="px-4 py-2 text-xs text-zinc-700 dark:text-zinc-300">
        {formatDateTime(deferral.createdAt)}
      </td>
      <td className="px-4 py-2 text-xs text-zinc-700 dark:text-zinc-300">
        {deferral.themeId ?? '—'}
      </td>
      <td className="px-4 py-2 text-right text-zinc-900 dark:text-zinc-100">
        {deferral.cpuBusyPercent === null ? '—' : formatPercent(deferral.cpuBusyPercent)}
        {deferral.thresholdPercent !== null && ` / ${formatPercent(deferral.thresholdPercent)}`}
      </td>
      <td className="px-4 py-2 text-right">
        {deferral.themeId !== null && (
          <button
            type="button"
            disabled={pending}
            onClick={() => onRunNow(deferral.themeId as number)}
            className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            {runNowLabel}
          </button>
        )}
      </td>
    </tr>
  );
}

export function ResourceContentionPanel() {
  const t = useTranslations('agents');
  const { status, deferrals, loaded, error, override } = useResourceGate();
  const [pendingThemeId, setPendingThemeId] = useState<number | null>(null);

  // Same convention as SystemStatusPanel/RecoveryMetricsPanel: render nothing
  // until the first response settles to avoid a flash of the empty state.
  if (!loaded) return null;

  const handleRunNow = async (themeId: number) => {
    setPendingThemeId(themeId);
    try {
      await override(themeId);
    } finally {
      setPendingThemeId(null);
    }
  };

  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center gap-2">
        <Thermometer className="h-4 w-4 text-zinc-400 dark:text-zinc-500" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          {t('resourceContention.title')}
        </h3>
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
            status?.enabled
              ? 'border-green-300 bg-green-50 text-green-700 dark:border-green-600 dark:bg-green-900/30 dark:text-green-400'
              : 'border-zinc-300 bg-zinc-50 text-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
          }`}
        >
          {status?.enabled ? t('resourceContention.enabled') : t('resourceContention.disabled')}
        </span>
      </div>
      <p className="mb-2 text-xs text-zinc-400 dark:text-zinc-500">
        {t('resourceContention.hostCpuNote')}
      </p>
      <div className="mb-3 grid grid-cols-3 divide-x divide-zinc-100 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-700 dark:border-zinc-700 dark:bg-zinc-800">
        <div className="px-4 py-3">
          <div className="text-lg font-bold leading-tight text-zinc-900 dark:text-zinc-50">
            {status?.hostCpuBusyPercent === null || status?.hostCpuBusyPercent === undefined
              ? t('resourceContention.unsampled')
              : formatPercent(status.hostCpuBusyPercent)}
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {t('resourceContention.currentCpu')}
          </p>
        </div>
        <div className="px-4 py-3">
          <div className="text-lg font-bold leading-tight text-zinc-900 dark:text-zinc-50">
            {status ? formatPercent(status.thresholdPercent) : '—'}
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {t('resourceContention.threshold')}
          </p>
        </div>
        <div className="px-4 py-3">
          <div className="text-lg font-bold leading-tight text-zinc-900 dark:text-zinc-50">
            {status?.effectiveMaxConcurrency ?? '—'}
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {t('resourceContention.effectiveMaxConcurrency')}
          </p>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800">
        {error ? (
          <p className="px-4 py-6 text-sm text-zinc-500 dark:text-zinc-400">
            {t('resourceContention.loadFailed')}
          </p>
        ) : deferrals.length === 0 ? (
          <p className="px-4 py-6 text-sm text-zinc-500 dark:text-zinc-400">
            {t('resourceContention.empty')}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400">
                <th className="px-4 py-2 font-medium">{t('resourceContention.deferredAt')}</th>
                <th className="px-4 py-2 font-medium">{t('resourceContention.theme')}</th>
                <th className="px-4 py-2 text-right font-medium">
                  {t('resourceContention.currentCpu')}
                </th>
                <th className="px-4 py-2 text-right font-medium">
                  {t('resourceContention.nextTick')}
                </th>
              </tr>
            </thead>
            <tbody>
              {deferrals.map((deferral, index) => (
                <DeferralRow
                  key={`${deferral.themeId}-${deferral.createdAt}-${index}`}
                  deferral={deferral}
                  runNowLabel={t('resourceContention.runNow')}
                  onRunNow={handleRunNow}
                  pending={pendingThemeId === deferral.themeId}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default ResourceContentionPanel;
