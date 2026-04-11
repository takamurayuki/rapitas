/**
 * AgentCard
 *
 * Renders a single agent row with status badge, action buttons, and
 * an expandable version history panel.
 * Not responsible for data fetching or global state management.
 */

'use client';

import {
  Package,
  Download,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Trash2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { VersionList } from './VersionList';
import { statusStyles } from './types';
import type { AgentConfig, AgentVersion } from './types';

const statusIcons: Record<
  AgentConfig['installationStatus'],
  React.ElementType
> = {
  not_installed: Package,
  installing: RefreshCw,
  installed: CheckCircle2,
  update_available: AlertCircle,
  error: AlertCircle,
};

interface AgentCardProps {
  agent: AgentConfig;
  versions: AgentVersion[];
  isExpanded: boolean;
  isInstalling: boolean;
  onInstall: (agentId: number, version?: string) => void;
  onUninstall: (agentId: number) => void;
  onToggleAutoUpdate: (agentId: number, enabled: boolean) => void;
  onToggleExpand: (agentId: number) => void;
}

/**
 * Displays agent metadata, installation controls, and a collapsible version list.
 *
 * @param props.agent - Agent configuration data / エージェント設定データ
 * @param props.versions - Available versions for this agent / このエージェントの利用可能バージョン
 * @param props.isExpanded - Whether the version list is visible / バージョン一覧の表示状態
 * @param props.isInstalling - Whether an install is in flight / インストール中かどうか
 * @param props.onInstall - Install trigger / インストールトリガー
 * @param props.onUninstall - Uninstall trigger / アンインストールトリガー
 * @param props.onToggleAutoUpdate - Auto-update toggle / 自動更新トグル
 * @param props.onToggleExpand - Expand/collapse toggle / 展開/折り畳みトグル
 */
export function AgentCard({
  agent,
  versions,
  isExpanded,
  isInstalling,
  onInstall,
  onUninstall,
  onToggleAutoUpdate,
  onToggleExpand,
}: AgentCardProps) {
  const t = useTranslations('agents');
  const StatusIcon = statusIcons[agent.installationStatus];

  return (
    <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      <div className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
              <Package className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {agent.name}
              </h3>
              <p className="text-zinc-500 dark:text-zinc-400 text-sm">
                {agent.description}
              </p>
              <div className="flex items-center gap-4 mt-2">
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyles[agent.installationStatus]}`}
                >
                  <StatusIcon className="w-3 h-3 mr-1" />
                  {agent.installationStatus === 'not_installed' &&
                    t('notInstalled')}
                  {agent.installationStatus === 'installing' && t('installing')}
                  {agent.installationStatus === 'installed' && t('installed')}
                  {agent.installationStatus === 'update_available' &&
                    t('updateAvailable')}
                  {agent.installationStatus === 'error' && t('error')}
                </span>
                {agent.currentVersion && (
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {t('current')}: v{agent.currentVersion}
                  </span>
                )}
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {t('latest')}: v{agent.latestVersion}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onToggleAutoUpdate(agent.id, !agent.autoUpdate)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                agent.autoUpdate
                  ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                  : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400'
              }`}
            >
              {t('autoUpdate')}: {agent.autoUpdate ? 'ON' : 'OFF'}
            </button>

            {agent.installationStatus === 'not_installed' && (
              <button
                onClick={() => onInstall(agent.id)}
                disabled={isInstalling}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                {isInstalling ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    {t('installing')}
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    {t('install')}
                  </>
                )}
              </button>
            )}

            {agent.installationStatus === 'update_available' && (
              <button
                onClick={() => onInstall(agent.id)}
                disabled={isInstalling}
                className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                {isInstalling ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    {t('updating')}
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    {t('refresh')}
                  </>
                )}
              </button>
            )}

            {agent.installationStatus === 'installed' && (
              <button
                onClick={() => onUninstall(agent.id)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                {t('delete')}
              </button>
            )}

            <button
              onClick={() => onToggleExpand(agent.id)}
              className="p-2 text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
            >
              {isExpanded ? (
                <ChevronUp className="w-5 h-5" />
              ) : (
                <ChevronDown className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      </div>

      {isExpanded && (
        <VersionList
          versions={versions}
          agentId={agent.id}
          isInstalling={isInstalling}
          onInstall={onInstall}
        />
      )}
    </div>
  );
}
