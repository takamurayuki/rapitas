'use client';

/**
 * AgentsPage
 *
 * Agent management: which providers this host can run, the workflow roles
 * that use them, and the permission prompt toggle. The agent and model of
 * each phase are chosen automatically from the usable providers and the
 * model tier table, so nothing here selects them.
 */
import { useTranslations } from 'next-intl';
import WorkflowRolesConfig from '@/components/workflow/WorkflowRolesConfig';
import { PhaseRoutingStatus } from './_components/PhaseRoutingStatus';
import { SkipPermissionToggle } from './_components/SkipPermissionToggle';
import { AGENTS_PANELS } from './_components/panels.generated';

// NOTE: GlobalProviderPreference and the per-role agent/model pickers were
// removed (2026-11-20). Phase routing no longer reads hand-set providers or
// models; the page used to fetch /agents/all and /agents/models only for them.
export default function AgentsPage() {
  const t = useTranslations('agents');

  // NOTE: No inner fixed-height overflow container. The header is `sticky
  // top-0`, so a single document-level scroll keeps it pinned — adding an
  // inner `h-[calc(100vh-Nrem)] overflow-auto` produced a SECOND scrollbar.
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-background">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{t('pageTitle')}</h1>
          <p className="text-zinc-500 dark:text-zinc-400 mt-1">{t('pageSubtitle')}</p>
        </div>

        {AGENTS_PANELS.map(({ id, Component }) => (
          <Component key={id} />
        ))}

        <div className="mb-6 space-y-3">
          <PhaseRoutingStatus />
          <SkipPermissionToggle />
        </div>

        <div className="mb-8">
          <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {t('workflowRoles')}
              </h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                {t('workflowRolesDescription')}
              </p>
            </div>
            <div className="p-6">
              <WorkflowRolesConfig />
            </div>
          </div>
        </div>

        <div className="p-6 bg-linear-to-br from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 rounded-lg border border-indigo-200 dark:border-indigo-800">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
            {t('howToUse')}
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            {(['1', '2', '3'] as const).map((n) => (
              <div key={n} className="flex gap-3">
                <div className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 font-medium">
                  {n}
                </div>
                <div>
                  <h3 className="font-medium text-zinc-900 dark:text-zinc-100">
                    {t(`step${n}Title`)}
                  </h3>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    {t(`step${n}Description`)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
