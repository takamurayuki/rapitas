/**
 * GitHubPageHeader
 *
 * Title block and "add integration" action for the GitHub overview page.
 */
'use client';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';

/**
 * Render the page title, subtitle, and add-integration button.
 *
 * @param props.onAdd - Open the add-integration modal. / 連携追加モーダルを開く。
 */
export function GitHubPageHeader({ onAdd }: { onAdd: () => void }) {
  const t = useTranslations('github');
  return (
    <div className="flex items-center justify-between mb-8">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{t('title')}</h1>
        <p className="text-zinc-500 dark:text-zinc-400 mt-1">{t('subtitle')}</p>
      </div>
      <button
        onClick={onAdd}
        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
      >
        <Plus className="w-4 h-4" />
        {t('addIntegration')}
      </button>
    </div>
  );
}
