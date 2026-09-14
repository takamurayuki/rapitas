'use client';
/**
 * AgentSupervisionPage
 *
 * Shows whether the supervision acceptance bar (hands-off 24h / 10 tasks plus a
 * knowledge-reuse comparison) is met, every unmet reason, and the measured
 * denominators behind the verdict. A fetch failure is shown as not met.
 */

import { useTranslations } from 'next-intl';
import {
  useSupervisionAcceptance,
  type SupervisionAcceptanceStatus,
} from './_hooks/useSupervisionAcceptance';

/** One label/value row in a definition grid. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-zinc-100 dark:border-zinc-800 last:border-0">
      <dt className="text-sm text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-sm font-medium text-zinc-900 dark:text-zinc-100 text-right tabular-nums">
        {value}
      </dd>
    </div>
  );
}

/** Formats an optional value, showing a placeholder for missing data. */
function show(value: number | string | boolean | null | undefined, fallback: string): string {
  return value === null || value === undefined || value === '' ? fallback : String(value);
}

/** Verdict badge; anything but an explicit met=true renders as not met. */
function VerdictBadge({ met }: { met: boolean }) {
  const t = useTranslations('agents.supervision');
  return (
    <span
      data-testid="supervision-verdict"
      className={
        met
          ? 'inline-flex rounded-full px-3 py-1 text-sm font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
          : 'inline-flex rounded-full px-3 py-1 text-sm font-semibold bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300'
      }
    >
      {met ? t('met') : t('notMet')}
    </span>
  );
}

/** Landing classes in display order; mirrors the backend classifier. */
const LANDING_CLASSES = [
  'qualified',
  'landing_pending',
  'policy_unreadable',
  'merge_not_requested',
  'criteria_missing',
  'unverified_completion',
  'publish_after_stop',
  'manual_merge',
  'landing_failed',
  'subtask',
] as const;

/**
 * Parses the snapshot's landing-class counts. Older snapshots have none.
 *
 * @param raw - `denominators.landingClassCounts` JSON string / 着地分類件数のJSON文字列
 * @returns Counts per class, or null when absent or malformed / 分類ごとの件数（無ければnull）
 */
function parseLandingClassCounts(raw: unknown): Record<string, number> | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] => typeof entry[1] === 'number',
      ),
    );
  } catch {
    return null;
  }
}

/** Per-class counts of how completed tasks landed (only `qualified` counts). */
function LandingSection({
  status,
  className,
}: {
  status: SupervisionAcceptanceStatus;
  className: string;
}) {
  const t = useTranslations('agents.supervision');
  const counts = parseLandingClassCounts(status.denominators.landingClassCounts);
  return (
    <section className={className}>
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
        {t('landingTitle')}
      </h2>
      {counts === null ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('none')}</p>
      ) : (
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8" data-testid="supervision-landing">
          {LANDING_CLASSES.map((c) => (
            <Row key={c} label={t(`landingClasses.${c}`)} value={String(counts[c] ?? 0)} />
          ))}
        </dl>
      )}
    </section>
  );
}

/** Measured denominators and knowledge-reuse comparison for a loaded status. */
function StatusDetails({ status }: { status: SupervisionAcceptanceStatus }) {
  const t = useTranslations('agents.supervision');
  const none = t('none');
  const d = status.denominators;
  const card =
    'rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5';
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <section className={card}>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
          {t('reasonsTitle')}
        </h2>
        {status.reasonCodes.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('noReasons')}</p>
        ) : (
          <ul className="list-disc pl-5 space-y-1" data-testid="supervision-reasons">
            {status.reasonCodes.map((code) => (
              <li key={code} className="text-sm text-zinc-800 dark:text-zinc-200">
                {t.has(`reasons.${code}`) ? t(`reasons.${code}`) : code}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={card}>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
          {t('denominatorsTitle')}
        </h2>
        <dl>
          <Row
            label={t('streakCount')}
            value={t('threshold', {
              value: status.streakCount,
              required: show(d.requiredTasks, '10'),
            })}
          />
          <Row
            label={t('observedHours')}
            value={t('threshold', {
              value: show(status.hoursSinceLastIntervention, none),
              required: show(d.requiredHours, '24'),
            })}
          />
          <Row label={t('observedGapMinutes')} value={String(status.observedGapMinutes)} />
          <Row
            label={t('heartbeat')}
            value={
              status.heartbeatAgeSeconds === null
                ? t('heartbeatNone')
                : `${t('heartbeatAge', { seconds: status.heartbeatAgeSeconds })} (${status.heartbeatCount})`
            }
          />
          <Row
            label={t('snapshotAge')}
            value={
              status.snapshotAgeMinutes === null
                ? t('snapshotNone')
                : t('snapshotAgeValue', { minutes: status.snapshotAgeMinutes })
            }
          />
          <Row
            label={t('blockingTasks')}
            value={
              status.blockingTaskIds.length > 0
                ? status.blockingTaskIds.map((id) => `#${id}`).join(', ')
                : none
            }
          />
        </dl>
      </section>

      <LandingSection status={status} className={`${card} lg:col-span-2`} />

      <section className={`${card} lg:col-span-2`}>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
          {t('knowledgeTitle')}
        </h2>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
          <Row label={t('evalSetVersion')} value={show(status.evalSetVersion, none)} />
          <Row label={t('methodVersion')} value={show(d.knowledgeMethodVersion, none)} />
          <Row label={t('pairedN')} value={show(d.knowledgePairedN, none)} />
          <Row label={t('missingRetainedN')} value={show(d.knowledgeMissingRetainedN, none)} />
          <Row label={t('successWithKB')} value={show(d.knowledgeSuccessRateWithKB, none)} />
          <Row label={t('successWithoutKB')} value={show(d.knowledgeSuccessRateWithoutKB, none)} />
          <Row
            label={t('effect')}
            value={`${show(d.knowledgeEffectSize, none)} / ${show(d.knowledgeIntervalOrPValue, none)}`}
          />
        </dl>
      </section>
    </div>
  );
}

export default function AgentSupervisionPage() {
  const t = useTranslations('agents.supervision');
  const { status, loading, error } = useSupervisionAcceptance();

  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-[var(--background)] scrollbar-thin">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{t('title')}</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t('subtitle')}</p>
          </div>
          {!loading && <VerdictBadge met={!error && status?.met === true} />}
        </header>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-4 text-sm text-rose-800 dark:text-rose-300"
          >
            {t('loadFailed')}
          </div>
        )}

        {loading && !status ? (
          <div className="animate-pulse h-64 bg-zinc-200 dark:bg-zinc-700 rounded-xl" />
        ) : (
          status && <StatusDetails status={status} />
        )}
      </div>
    </div>
  );
}
