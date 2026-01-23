import { useState, useCallback } from "react";
import type {
  GitHubIntegration,
  GitHubPullRequest,
  GitHubIssue,
  FileDiff,
} from "@/types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

export type CreateIntegrationInput = {
  repositoryUrl: string;
  ownerName: string;
  repositoryName: string;
  syncIssues?: boolean;
  syncPullRequests?: boolean;
  autoLinkTasks?: boolean;
};

export type UseGitHubIntegrationReturn = {
  loading: boolean;
  error: string | null;
  // Status
  checkGitHubStatus: () => Promise<{ ghAvailable: boolean; authenticated: boolean }>;
  // Integrations
  getIntegrations: () => Promise<GitHubIntegration[]>;
  getIntegration: (id: number) => Promise<GitHubIntegration>;
  createIntegration: (input: CreateIntegrationInput) => Promise<GitHubIntegration>;
  deleteIntegration: (id: number) => Promise<void>;
  // Sync
  syncPullRequests: (integrationId: number) => Promise<{ syncedCount: number }>;
  syncIssues: (integrationId: number) => Promise<{ syncedCount: number }>;
  // Pull Requests
  getPullRequests: (integrationId: number, state?: string) => Promise<GitHubPullRequest[]>;
  getPullRequest: (id: number) => Promise<GitHubPullRequest>;
  getPullRequestDiff: (id: number) => Promise<FileDiff[]>;
  approvePullRequest: (id: number, body?: string) => Promise<void>;
  requestChanges: (id: number, body: string) => Promise<void>;
  commentOnPullRequest: (id: number, body: string, path?: string, line?: number) => Promise<void>;
  // Issues
  getIssues: (integrationId: number, state?: string) => Promise<GitHubIssue[]>;
  getIssue: (id: number) => Promise<GitHubIssue>;
  createTaskFromIssue: (issueId: number, options?: { projectId?: number; themeId?: number }) => Promise<any>;
  createIssueFromTask: (taskId: number, integrationId: number, labels?: string[]) => Promise<GitHubIssue>;
  linkPullRequestToTask: (taskId: number, prId: number) => Promise<void>;
};

export function useGitHubIntegration(): UseGitHubIntegrationReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async <T>(
    url: string,
    options?: RequestInit
  ): Promise<T> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}${url}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options?.headers,
        },
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Request failed");
      }

      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Status
  const checkGitHubStatus = useCallback(() => {
    return request<{ ghAvailable: boolean; authenticated: boolean }>("/github/status");
  }, [request]);

  // Integrations
  const getIntegrations = useCallback(() => {
    return request<GitHubIntegration[]>("/github/integrations");
  }, [request]);

  const getIntegration = useCallback((id: number) => {
    return request<GitHubIntegration>(`/github/integrations/${id}`);
  }, [request]);

  const createIntegration = useCallback((input: CreateIntegrationInput) => {
    return request<GitHubIntegration>("/github/integrations", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }, [request]);

  const deleteIntegration = useCallback(async (id: number) => {
    await request(`/github/integrations/${id}`, { method: "DELETE" });
  }, [request]);

  // Sync
  const syncPullRequests = useCallback((integrationId: number) => {
    return request<{ syncedCount: number }>(
      `/github/integrations/${integrationId}/sync-prs`,
      { method: "POST" }
    );
  }, [request]);

  const syncIssues = useCallback((integrationId: number) => {
    return request<{ syncedCount: number }>(
      `/github/integrations/${integrationId}/sync-issues`,
      { method: "POST" }
    );
  }, [request]);

  // Pull Requests
  const getPullRequests = useCallback((integrationId: number, state = "open") => {
    return request<GitHubPullRequest[]>(
      `/github/integrations/${integrationId}/pull-requests?state=${state}`
    );
  }, [request]);

  const getPullRequest = useCallback((id: number) => {
    return request<GitHubPullRequest>(`/github/pull-requests/${id}`);
  }, [request]);

  const getPullRequestDiff = useCallback((id: number) => {
    return request<FileDiff[]>(`/github/pull-requests/${id}/diff`);
  }, [request]);

  const approvePullRequest = useCallback(async (id: number, body?: string) => {
    await request(`/github/pull-requests/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  }, [request]);

  const requestChanges = useCallback(async (id: number, body: string) => {
    await request(`/github/pull-requests/${id}/request-changes`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  }, [request]);

  const commentOnPullRequest = useCallback(
    async (id: number, body: string, path?: string, line?: number) => {
      await request(`/github/pull-requests/${id}/comments`, {
        method: "POST",
        body: JSON.stringify({ body, path, line }),
      });
    },
    [request]
  );

  // Issues
  const getIssues = useCallback((integrationId: number, state = "open") => {
    return request<GitHubIssue[]>(
      `/github/integrations/${integrationId}/issues?state=${state}`
    );
  }, [request]);

  const getIssue = useCallback((id: number) => {
    return request<GitHubIssue>(`/github/issues/${id}`);
  }, [request]);

  const createTaskFromIssue = useCallback(
    (issueId: number, options?: { projectId?: number; themeId?: number }) => {
      return request(`/github/issues/${issueId}/create-task`, {
        method: "POST",
        body: JSON.stringify(options || {}),
      });
    },
    [request]
  );

  const createIssueFromTask = useCallback(
    (taskId: number, integrationId: number, labels?: string[]) => {
      return request<GitHubIssue>(`/tasks/${taskId}/create-github-issue`, {
        method: "POST",
        body: JSON.stringify({ integrationId, labels }),
      });
    },
    [request]
  );

  const linkPullRequestToTask = useCallback(async (taskId: number, prId: number) => {
    await request(`/tasks/${taskId}/link-github-pr/${prId}`, {
      method: "POST",
    });
  }, [request]);

  return {
    loading,
    error,
    checkGitHubStatus,
    getIntegrations,
    getIntegration,
    createIntegration,
    deleteIntegration,
    syncPullRequests,
    syncIssues,
    getPullRequests,
    getPullRequest,
    getPullRequestDiff,
    approvePullRequest,
    requestChanges,
    commentOnPullRequest,
    getIssues,
    getIssue,
    createTaskFromIssue,
    createIssueFromTask,
    linkPullRequestToTask,
  };
}
