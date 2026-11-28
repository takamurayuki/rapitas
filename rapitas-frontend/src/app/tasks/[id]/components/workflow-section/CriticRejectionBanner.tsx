/**
 * CriticRejectionBanner
 *
 * Shows why the phase critic rejected the latest research.md / plan.md.
 * Not responsible for fetching the rejection.
 */
import { useTranslations } from 'next-intl';
import type { CriticRejection } from '../../hooks/useCriticRejection';

/**
 * Rejection banner with severity badge and reasons.
 *
 * @param props.criticRejection - Active rejection / 表示する却下情報
 */
export default function CriticRejectionBanner({
  criticRejection,
}: {
  criticRejection: CriticRejection;
}) {
  const t = useTranslations('workflow');

  // Escalating colour so a severity-92 rejection reads as more urgent than a
  // severity-55 one at a glance, instead of every rejection looking identical.
  const severityStyle = (severity: number | null): { label: string; chip: string } | null => {
    if (severity == null) return null;
    if (severity >= 80) {
      return {
        label: t('taskWorkflowSection.criticRejection.severity.high'),
        chip: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
      };
    }
    if (severity >= 50) {
      return {
        label: t('taskWorkflowSection.criticRejection.severity.medium'),
        chip: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
      };
    }
    return {
      label: t('taskWorkflowSection.criticRejection.severity.low'),
      chip: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
    };
  };

  const severity = severityStyle(criticRejection.severity);
  return (
    <div className="px-4 pb-4">
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-sm text-amber-700 dark:text-amber-300 font-medium">
            {t('taskWorkflowSection.criticRejection.title', {
              phase: t(`taskWorkflowSection.criticRejection.phase.${criticRejection.phase}`),
            })}
          </p>
          <div className="flex items-center gap-1.5 shrink-0">
            {severity && (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${severity.chip}`}>
                {severity.label}
                {criticRejection.severity != null ? ` (${criticRejection.severity})` : ''}
              </span>
            )}
            {criticRejection.reasons.length > 1 && (
              <span className="rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                {t('taskWorkflowSection.criticRejection.reasonsCount', {
                  count: criticRejection.reasons.length,
                })}
              </span>
            )}
          </div>
        </div>
        {criticRejection.reasons.length > 0 && (
          <ul className="mt-2 list-disc list-outside space-y-1.5 pl-5 text-sm text-amber-700 dark:text-amber-300 leading-relaxed">
            {criticRejection.reasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
