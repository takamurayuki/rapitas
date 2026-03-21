/**
 * VersionList
 *
 * Renders the expandable list of available versions for a single agent.
 * Not responsible for fetching data or managing install state.
 */

'use client';

import { Tag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useLocaleStore } from '@/stores/locale-store';
import { toDateLocale } from '@/lib/utils';
import type { AgentVersion } from './types';

interface VersionListProps {
  versions: AgentVersion[];
  agentId: number;
  isInstalling: boolean;
  /** Called when the user requests installation of a specific version. */
  onInstall: (agentId: number, version: string) => void;
}

/**
 * Renders a scrollable list of version rows with install controls.
 *
 * @param props.versions - Version records to display / 表示するバージョン一覧
 * @param props.agentId - Parent agent identifier / 親エージェントID
 * @param props.isInstalling - Whether an install is in flight / インストール中かどうか
 * @param props.onInstall - Install trigger callback / インストールトリガーコールバック
 */
export function VersionList({ versions, agentId, isInstalling, onInstall }: VersionListProps) {
  const t = useTranslations('agents');
  const locale = useLocaleStore((s) => s.locale);
  const dateLocale = toDateLocale(locale);

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-750">
      <div className="p-6">
        <h4 className="text-md font-medium text-zinc-900 dark:text-zinc-100 mb-4">
          {t('availableVersions')}
        </h4>
        <div className="space-y-3">
          {versions.map((version) => (
            <div
              key={version.id}
              className="flex items-center justify-between p-4 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700"
            >
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Tag className="w-4 h-4 text-zinc-500" />
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    v{version.version}
                  </span>
                  {version.isStable && (
                    <span className="px-2 py-1 text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 rounded">
                      {t('stable')}
                    </span>
                  )}
                  {version.isInstalled && (
                    <span className="px-2 py-1 text-xs bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300 rounded">
                      {t('installed')}
                    </span>
                  )}
                </div>
                <div className="text-sm text-zinc-500 dark:text-zinc-400">
                  {new Date(version.createdAt).toLocaleDateString(dateLocale)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {version.size && (
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {(version.size / 1024 / 1024).toFixed(1)}MB
                  </span>
                )}
                {!version.isInstalled && (
                  <button
                    onClick={() => onInstall(agentId, version.version)}
                    disabled={isInstalling}
                    className="px-3 py-1 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                  >
                    {t('install')}
                  </button>
                )}
              </div>
            </div>
          ))}
          {versions.length === 0 && (
            <p className="text-zinc-500 dark:text-zinc-400 text-sm">{t('noVersionInfo')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
