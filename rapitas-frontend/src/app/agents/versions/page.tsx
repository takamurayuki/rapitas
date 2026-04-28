'use client';
// AgentVersionManagementPage

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Package, AlertCircle, RefreshCw, Search, Filter } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { requireAuth } from '@/contexts/AuthContext';
import { createLogger } from '@/lib/logger';
import { AgentCard } from './_components/AgentCard';
import type { AgentConfig, AgentVersion } from './_components/types';

const logger = createLogger('AgentVersionManagementPage');

function AgentVersionManagementPage() {
  const t = useTranslations('agents');
  const [agentConfigs, setAgentConfigs] = useState<AgentConfig[]>([]);
  const [agentVersions, setAgentVersions] = useState<AgentVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedVersions, setExpandedVersions] = useState<Set<number>>(new Set());
  const [installing, setInstalling] = useState<Set<number>>(new Set());

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

  const installAgent = async (agentId: number, version?: string) => {
    try {
      setInstalling((prev) => new Set(prev).add(agentId));

      const response = await fetch(`${API_BASE_URL}/agent-version-management/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, version }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        await fetchData();
      } else {
        setError(data.error || t('installFailed'));
      }
    } catch (err) {
      logger.error('Install error:', err);
      setError(t('installError'));
    } finally {
      setInstalling((prev) => {
        const newSet = new Set(prev);
        newSet.delete(agentId);
        return newSet;
      });
    }
  };

  const uninstallAgent = async (agentId: number) => {
    try {
      const response = await fetch(`${API_BASE_URL}/agent-version-management/uninstall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        await fetchData();
      } else {
        setError(data.error || t('uninstallFailed'));
      }
    } catch (err) {
      logger.error('Uninstall error:', err);
      setError(t('uninstallError'));
    }
  };

  const toggleAutoUpdate = async (agentId: number, enabled: boolean) => {
    try {
      const response = await fetch(`${API_BASE_URL}/agent-version-management/auto-update`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, enabled }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        await fetchData();
      } else {
        setError(data.error || t('autoUpdateFailed'));
      }
    } catch (err) {
      logger.error('Auto-update setting error:', err);
      setError(t('autoUpdateError'));
    }
  };

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

  const getAgentVersions = (agentId: number) =>
    agentVersions
      .filter((v) => v.agentId === agentId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const filteredAgents = agentConfigs.filter((agent) => {
    const matchesSearch =
      agent.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      agent.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || agent.installationStatus === statusFilter;
    return matchesSearch && matchesStatus;
  });

  if (loading) return <LoadingSpinner />;

  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-[var(--background)] scrollbar-thin">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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

        <div className="mb-6 p-4 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700">
          <div className="flex flex-col lg:flex-row gap-4">
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

        <div className="space-y-4">
          {filteredAgents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              versions={getAgentVersions(agent.id)}
              isExpanded={expandedVersions.has(agent.id)}
              isInstalling={installing.has(agent.id)}
              onInstall={installAgent}
              onUninstall={uninstallAgent}
              onToggleAutoUpdate={toggleAutoUpdate}
              onToggleExpand={toggleVersionExpansion}
            />
          ))}

          {filteredAgents.length === 0 && (
            <div className="text-center py-12">
              <Package className="w-12 h-12 text-zinc-400 mx-auto mb-4" />
              <p className="text-zinc-500 dark:text-zinc-400">{t('noMatchingAgents')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default requireAuth(AgentVersionManagementPage);
