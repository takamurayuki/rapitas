'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import {
  Package,
  Download,
  CheckCircle2,
  AlertCircle,
  Clock,
  RefreshCw,
  Search,
  Filter,
  Settings,
  Trash2,
  ExternalLink,
  GitBranch,
  Tag,
  Calendar,
  User,
  ChevronDown,
  ChevronUp,
  Play,
  Pause,
  RotateCcw,
} from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { requireAuth } from '@/contexts/AuthContext';
import { createLogger } from '@/lib/logger';
import { useLocaleStore } from '@/stores/localeStore';
import { toDateLocale } from '@/lib/utils';

const logger = createLogger('AgentVersionManagementPage');

// 型定義
interface AgentVersion {
  id: number;
  agentId: number;
  agentName: string;
  version: string;
  description: string;
  changelog: string;
  isStable: boolean;
  isInstalled: boolean;
  installationDate: string | null;
  createdAt: string;
  downloadUrl: string | null;
  size: number | null;
  dependencies: string[];
}

interface AgentConfig {
  id: number;
  name: string;
  description: string;
  currentVersion: string | null;
  latestVersion: string;
  isInstalled: boolean;
  installationStatus:
    | 'not_installed'
    | 'installing'
    | 'installed'
    | 'update_available'
    | 'error';
  lastUpdatedAt: string | null;
  autoUpdate: boolean;
}

// ステータス別のスタイル
const statusStyles = {
  not_installed:
    'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300',
  installing:
    'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  installed:
    'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  update_available:
    'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  error: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
};

const statusIcons = {
  not_installed: Package,
  installing: RefreshCw,
  installed: CheckCircle2,
  update_available: AlertCircle,
  error: AlertCircle,
};

function AgentVersionManagementPage() {
  const t = useTranslations('agents');
  const locale = useLocaleStore((s) => s.locale);
  const dateLocale = toDateLocale(locale);
  // State
  const [agentConfigs, setAgentConfigs] = useState<AgentConfig[]>([]);
  const [agentVersions, setAgentVersions] = useState<AgentVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null);
  const [expandedVersions, setExpandedVersions] = useState<Set<number>>(
    new Set(),
  );
  const [installing, setInstalling] = useState<Set<number>>(new Set());

  // データ取得
  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [configsRes, versionsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/agent-version-management/configs`),
        fetch(`${API_BASE_URL}/agent-version-management/versions`),
      ]);

      if (configsRes.ok) {
        const data = await configsRes.json();
        setAgentConfigs(data.configs || []);
      }

      if (versionsRes.ok) {
        const data = await versionsRes.json();
        setAgentVersions(data.versions || []);
      }
    } catch (err) {
      logger.error('Failed to fetch data:', err);
      setError(t('dataFetchFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // エージェントのインストール
  const installAgent = async (agentId: number, version?: string) => {
    try {
      setInstalling((prev) => new Set(prev).add(agentId));

      const response = await fetch(
        `${API_BASE_URL}/agent-version-management/install`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ agentId, version }),
        },
      );

      const data = await response.json();

      if (response.ok && data.success) {
        // 成功時はデータを再取得
        await fetchData();
      } else {
        setError(data.error || t('installFailed'));
      }
    } catch (err) {
      logger.error('インストールエラー:', err);
      setError(t('installError'));
    } finally {
      setInstalling((prev) => {
        const newSet = new Set(prev);
        newSet.delete(agentId);
        return newSet;
      });
    }
  };

  // エージェントのアンインストール
  const uninstallAgent = async (agentId: number) => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/agent-version-management/uninstall`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ agentId }),
        },
      );

      const data = await response.json();

      if (response.ok && data.success) {
        await fetchData();
      } else {
        setError(data.error || t('uninstallFailed'));
      }
    } catch (err) {
      logger.error('アンインストールエラー:', err);
      setError(t('uninstallError'));
    }
  };

  // 自動更新設定の切り替え
  const toggleAutoUpdate = async (agentId: number, enabled: boolean) => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/agent-version-management/auto-update`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ agentId, enabled }),
        },
      );

      const data = await response.json();

      if (response.ok && data.success) {
        await fetchData();
      } else {
        setError(data.error || t('autoUpdateFailed'));
      }
    } catch (err) {
      logger.error('自動更新設定エラー:', err);
      setError(t('autoUpdateError'));
    }
  };

  // フィルタリング
  const filteredAgents = agentConfigs.filter((agent) => {
    const matchesSearch =
      agent.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      agent.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus =
      statusFilter === 'all' || agent.installationStatus === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // バージョン展開/折りたたみ
  const toggleVersionExpansion = (agentId: number) => {
    setExpandedVersions((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(agentId)) {
        newSet.delete(agentId);
      } else {
        newSet.add(agentId);
      }
      return newSet;
    });
  };

  // 特定エージェントのバージョン取得
  const getAgentVersions = (agentId: number) => {
    return agentVersions
      .filter((v) => v.agentId === agentId)
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-[var(--background)] scrollbar-thin">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
              {t('versionManagement')}
            </h1>
            <p className="text-zinc-500 dark:text-zinc-400 mt-1">
              {t('versionManagementDescription')}
            </p>
          </div>
          <button
            onClick={fetchData}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            {t('refresh')}
          </button>
        </div>

        {/* エラー表示 */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
            <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
            <button
              onClick={() => setError(null)}
              className="ml-auto text-red-400 hover:text-red-600 dark:hover:text-red-300"
            >
              ×
            </button>
          </div>
        )}

        {/* フィルターセクション */}
        <div className="mb-6 p-4 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700">
          <div className="flex flex-col lg:flex-row gap-4">
            {/* 検索 */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <input
                type="text"
                placeholder={t('searchAgent')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
              />
            </div>

            {/* ステータスフィルター */}
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="pl-10 pr-8 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
              >
                <option value="all">{t('allStatuses')}</option>
                <option value="not_installed">{t('notInstalled')}</option>
                <option value="installed">{t('installed')}</option>
                <option value="update_available">{t('updateAvailable')}</option>
                <option value="installing">{t('installing')}</option>
                <option value="error">{t('error')}</option>
              </select>
            </div>
          </div>
        </div>

        {/* エージェント一覧 */}
        <div className="space-y-4">
          {filteredAgents.map((agent) => {
            const StatusIcon = statusIcons[agent.installationStatus];
            const isExpanded = expandedVersions.has(agent.id);
            const versions = getAgentVersions(agent.id);
            const isInstalling = installing.has(agent.id);

            return (
              <div
                key={agent.id}
                className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden"
              >
                {/* エージェントヘッダー */}
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
                            {agent.installationStatus === 'installing' &&
                              t('installing')}
                            {agent.installationStatus === 'installed' &&
                              t('installed')}
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

                    {/* アクションボタン */}
                    <div className="flex items-center gap-2">
                      {/* 自動更新トグル */}
                      <button
                        onClick={() =>
                          toggleAutoUpdate(agent.id, !agent.autoUpdate)
                        }
                        className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                          agent.autoUpdate
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                            : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400'
                        }`}
                      >
                        {t('autoUpdate')}: {agent.autoUpdate ? 'ON' : 'OFF'}
                      </button>

                      {/* インストール/更新ボタン */}
                      {agent.installationStatus === 'not_installed' && (
                        <button
                          onClick={() => installAgent(agent.id)}
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
                          onClick={() => installAgent(agent.id)}
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
                          onClick={() => uninstallAgent(agent.id)}
                          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2"
                        >
                          <Trash2 className="w-4 h-4" />
                          {t('delete')}
                        </button>
                      )}

                      {/* バージョン展開ボタン */}
                      <button
                        onClick={() => toggleVersionExpansion(agent.id)}
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

                {/* バージョン詳細 */}
                {isExpanded && (
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
                                {new Date(version.createdAt).toLocaleDateString(
                                  dateLocale,
                                )}
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
                                  onClick={() =>
                                    installAgent(agent.id, version.version)
                                  }
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
                          <p className="text-zinc-500 dark:text-zinc-400 text-sm">
                            {t('noVersionInfo')}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {filteredAgents.length === 0 && (
            <div className="text-center py-12">
              <Package className="w-12 h-12 text-zinc-400 mx-auto mb-4" />
              <p className="text-zinc-500 dark:text-zinc-400">
                {t('noMatchingAgents')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// 認証が必要なページとしてエクスポート
export default requireAuth(AgentVersionManagementPage);
