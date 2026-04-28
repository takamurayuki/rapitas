'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Activity, Brain } from 'lucide-react';
import type { AIAgentConfig } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import WorkflowRolesConfig from '@/components/workflow/WorkflowRolesConfig';
import { GlobalProviderPreference } from './_components/GlobalProviderPreference';
import { createLogger } from '@/lib/logger';

const logger = createLogger('AgentsPage');

type ModelOption = {
  value: string;
  label: string;
  description?: string;
};

// Cache configuration
const CACHE_KEYS = {
  agents: 'agents-cache',
  agentTypes: 'agent-types-cache',
  // NOTE: Bumped to v2 when /agents/models switched from hardcoded fallback
  // to live `model-discovery` results — invalidates stale browser caches.
  models: 'agent-models-cache-v2',
} as const;

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

function getCachedData<T>(key: string): T | null {
  try {
    const cached = localStorage.getItem(key);
    if (!cached) return null;
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp > CACHE_DURATION) {
      localStorage.removeItem(key);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function setCachedData<T>(key: string, data: T): void {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        data,
        timestamp: Date.now(),
      }),
    );
  } catch (error) {
    logger.error('Failed to cache data:', error);
  }
}

export default function AgentsPage() {
  const t = useTranslations('agents');
  const [agents, setAgents] = useState<AIAgentConfig[]>([]);
  const [_loading, setLoading] = useState(true);
  const [availableModels, setAvailableModels] = useState<
    Record<string, ModelOption[]>
  >({});

  const fetchData = useCallback(async () => {
    try {
      // Check cache first
      const cachedAgents = getCachedData<AIAgentConfig[]>(CACHE_KEYS.agents);
      const cachedModels = getCachedData<Record<string, ModelOption[]>>(
        CACHE_KEYS.models,
      );

      if (cachedAgents && cachedModels) {
        setAgents(cachedAgents);
        setAvailableModels(cachedModels);
        setLoading(false);

        // Fetch in background to update cache
        Promise.all([
          fetch(`${API_BASE_URL}/agents/all`),
          fetch(`${API_BASE_URL}/agents/models`),
        ])
          .then(async ([agentsRes, modelsRes]) => {
            if (agentsRes.ok) {
              const agentsData = await agentsRes.json();
              setAgents(agentsData);
              setCachedData(CACHE_KEYS.agents, agentsData);
            }
            if (modelsRes.ok) {
              const modelsData = await modelsRes.json();
              setAvailableModels(modelsData);
              setCachedData(CACHE_KEYS.models, modelsData);
            }
          })
          .catch(() => {
            // NOTE: Non-critical background refresh — cached data remains valid.
          });
        return;
      }

      const [agentsRes, modelsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/agents/all`),
        fetch(`${API_BASE_URL}/agents/models`),
      ]);

      if (agentsRes.ok) {
        const agentsData = await agentsRes.json();
        setAgents(agentsData);
        setCachedData(CACHE_KEYS.agents, agentsData);
      }
      if (modelsRes.ok) {
        const modelsData = await modelsRes.json();
        setAvailableModels(modelsData);
        setCachedData(CACHE_KEYS.models, modelsData);
      }
    } catch (err) {
      logger.error('Failed to fetch agents:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-background scrollbar-thin">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                {t('pageTitle')}
              </h1>
              <p className="text-zinc-500 dark:text-zinc-400 mt-1">
                {t('pageSubtitle')}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/agents/memory"
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              >
                <Brain className="w-4 h-4" />
                記憶
              </Link>
              <Link
                href="/agents/metrics"
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
              >
                <Activity className="w-4 h-4" />
                {t('metrics')}
              </Link>
            </div>
          </div>
        </div>

        <div className="mb-6">
          <GlobalProviderPreference />
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
              <WorkflowRolesConfig
                agents={agents}
                availableModels={availableModels}
              />
            </div>
          </div>
        </div>

        <div className="p-6 bg-linear-to-br from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 rounded-lg border border-indigo-200 dark:border-indigo-800">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
            {t('howToUse')}
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex gap-3">
              <div className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 font-medium">
                1
              </div>
              <div>
                <h3 className="font-medium text-zinc-900 dark:text-zinc-100">
                  {t('step1Title')}
                </h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  {t('step1Description')}
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 font-medium">
                2
              </div>
              <div>
                <h3 className="font-medium text-zinc-900 dark:text-zinc-100">
                  {t('step2Title')}
                </h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  {t('step2Description')}
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 font-medium">
                3
              </div>
              <div>
                <h3 className="font-medium text-zinc-900 dark:text-zinc-100">
                  {t('step3Title')}
                </h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  {t('step3Description')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
