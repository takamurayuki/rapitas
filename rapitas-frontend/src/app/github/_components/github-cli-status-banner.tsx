/**
 * GitHubCliStatusBanner
 *
 * Colored banner reflecting the gh CLI state: authenticated, installed but not
 * authenticated, or not installed. Renders nothing until status is known.
 */
'use client';
import { useTranslations } from 'next-intl';
import { CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import type { GitHubCliStatus } from './github-dashboard.types';

/**
 * Render the gh CLI status banner.
 *
 * @param props.status - CLI availability/auth state, or null while unknown. / CLIの利用可否・認証状態。未取得時はnull。
 */
export function GitHubCliStatusBanner({ status }: { status: GitHubCliStatus | null }) {
  const t = useTranslations('github');
  if (!status) return null;

  return (
    <div
      className={`mb-6 p-4 rounded-lg border ${
        status.authenticated
          ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
          : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
      }`}
    >
      <div className="flex items-center gap-3">
        {status.authenticated ? (
          <>
            <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
            <span className="text-green-700 dark:text-green-300">{t('cliAuthenticated')}</span>
          </>
        ) : status.ghAvailable ? (
          <>
            <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
            <span className="text-yellow-700 dark:text-yellow-300">{t('cliNotAuthenticated')}</span>
          </>
        ) : (
          <>
            <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
            <span className="text-red-700 dark:text-red-300">{t('cliNotInstalled')}</span>
          </>
        )}
      </div>
    </div>
  );
}
