/**
 * useGithubDashboard
 *
 * Owns the GitHub overview page's data: CLI status, linked integrations, and the
 * first integration's open PRs/issues, plus per-integration sync. Holds no modal
 * or form state — that lives in the add-integration flow.
 */
'use client';
import { useEffect, useState } from 'react';
import type { GitHubIntegration, GitHubPullRequest, GitHubIssue } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import type { GitHubCliStatus } from '../_components/github-dashboard.types';

const logger = createLogger('GitHubPage');

/** The view model returned by {@link useGithubDashboard}. */
export interface GithubDashboardState {
  integrations: GitHubIntegration[];
  ghStatus: GitHubCliStatus | null;
  recentPRs: GitHubPullRequest[];
  recentIssues: GitHubIssue[];
  loading: boolean;
  syncing: number | null;
  fetchData: () => Promise<void>;
  syncIntegration: (id: number) => Promise<void>;
}

/**
 * Provide the GitHub overview page's data and sync action.
 *
 * @returns Integrations, CLI status, recent PR/issue lists, loading/sync flags, and refetch/sync handlers. / 連携・CLI状態・最近のPR/Issue一覧・読込/同期フラグ・再取得/同期ハンドラ。
 */
export function useGithubDashboard(): GithubDashboardState {
  const [integrations, setIntegrations] = useState<GitHubIntegration[]>([]);
  const [ghStatus, setGhStatus] = useState<GitHubCliStatus | null>(null);
  const [recentPRs, setRecentPRs] = useState<GitHubPullRequest[]>([]);
  const [recentIssues, setRecentIssues] = useState<GitHubIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<number | null>(null);

  const fetchData = async () => {
    try {
      const [statusRes, integrationsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/github/status`),
        fetch(`${API_BASE_URL}/github/integrations`),
      ]);

      if (statusRes.ok) {
        setGhStatus(await statusRes.json());
      }

      if (integrationsRes.ok) {
        const data = await integrationsRes.json();
        setIntegrations(data);

        // Fetch PRs and issues for the first integration
        if (data.length > 0) {
          const [prsRes, issuesRes] = await Promise.all([
            fetch(`${API_BASE_URL}/github/integrations/${data[0].id}/pull-requests?state=open`),
            fetch(`${API_BASE_URL}/github/integrations/${data[0].id}/issues?state=open`),
          ]);

          if (prsRes.ok) setRecentPRs(await prsRes.json());
          if (issuesRes.ok) setRecentIssues(await issuesRes.json());
        }
      }
    } catch (error) {
      logger.error('Failed to fetch GitHub data:', error);
    } finally {
      setLoading(false);
    }
  };

  const syncIntegration = async (id: number) => {
    setSyncing(id);
    try {
      await Promise.all([
        fetch(`${API_BASE_URL}/github/integrations/${id}/sync-prs`, {
          method: 'POST',
        }),
        fetch(`${API_BASE_URL}/github/integrations/${id}/sync-issues`, {
          method: 'POST',
        }),
      ]);
      await fetchData();
    } catch (error) {
      logger.error('Sync failed:', error);
    } finally {
      setSyncing(null);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  return {
    integrations,
    ghStatus,
    recentPRs,
    recentIssues,
    loading,
    syncing,
    fetchData,
    syncIntegration,
  };
}
