"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  CircleDot,
  Filter,
  ArrowLeft,
  Loader2,
  Plus,
  ArrowRightCircle,
} from "lucide-react";
import type { GitHubIssue, GitHubIntegration } from "@/types";
import { getLabelsArray, hasLabels } from "@/utils/labels";
import { getTaskDetailPath } from "@/utils/tauri";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

export default function IssuesPage() {
  const searchParams = useSearchParams();
  const integrationId = searchParams.get("integrationId");

  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  const [integrations, setIntegrations] = useState<GitHubIntegration[]>([]);
  const [selectedIntegration, setSelectedIntegration] = useState<string>(integrationId || "");
  const [stateFilter, setStateFilter] = useState<string>("open");
  const [loading, setLoading] = useState(true);
  const [creatingTask, setCreatingTask] = useState<number | null>(null);

  useEffect(() => {
    fetchIntegrations();
  }, []);

  useEffect(() => {
    if (selectedIntegration) {
      fetchIssues();
    }
  }, [selectedIntegration, stateFilter]);

  const fetchIntegrations = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/github/integrations`);
      if (res.ok) {
        const data = await res.json();
        setIntegrations(data);
        if (!selectedIntegration && data.length > 0) {
          setSelectedIntegration(data[0].id.toString());
        }
      }
    } catch (error) {
      console.error("Failed to fetch integrations:", error);
    }
  };

  const fetchIssues = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/github/integrations/${selectedIntegration}/issues?state=${stateFilter}`
      );
      if (res.ok) {
        setIssues(await res.json());
      }
    } catch (error) {
      console.error("Failed to fetch issues:", error);
    } finally {
      setLoading(false);
    }
  };

  const createTaskFromIssue = async (issueId: number) => {
    setCreatingTask(issueId);
    try {
      const res = await fetch(`${API_BASE_URL}/github/issues/${issueId}/create-task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (res.ok) {
        // 成功通知（省略可能）
        await fetchIssues();
      }
    } catch (error) {
      console.error("Failed to create task:", error);
    } finally {
      setCreatingTask(null);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* ヘッダー */}
      <div className="flex items-center gap-4 mb-6">
        <Link
          href="/github"
          className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Issues</h1>
          <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-1">
            Issueの確認・タスク化
          </p>
        </div>
      </div>

      {/* フィルター */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-zinc-400" />
          <select
            value={selectedIntegration}
            onChange={(e) => setSelectedIntegration(e.target.value)}
            className="px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          >
            <option value="">リポジトリを選択</option>
            {integrations.map((integration) => (
              <option key={integration.id} value={integration.id}>
                {integration.ownerName}/{integration.repositoryName}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg p-1">
          {["open", "closed", "all"].map((state) => (
            <button
              key={state}
              onClick={() => setStateFilter(state)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                stateFilter === state
                  ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              {state === "open" ? "Open" : state === "closed" ? "Closed" : "All"}
            </button>
          ))}
        </div>
      </div>

      {/* Issueリスト */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
        </div>
      ) : issues.length === 0 ? (
        <div className="text-center py-12 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700">
          <CircleDot className="w-12 h-12 mx-auto text-zinc-400 mb-4" />
          <p className="text-zinc-500 dark:text-zinc-400">
            {selectedIntegration
              ? "Issueがありません"
              : "リポジトリを選択してください"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {issues.map((issue) => (
            <div
              key={issue.id}
              className="p-4 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:shadow-md transition-all"
            >
              <div className="flex items-start gap-4">
                <CircleDot className={`w-5 h-5 mt-0.5 ${
                  issue.state === "open" ? "text-green-500" : "text-purple-500"
                }`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Link
                      href={`/github/issues/${issue.id}`}
                      className="font-medium text-zinc-900 dark:text-zinc-100 hover:text-indigo-600 dark:hover:text-indigo-400 truncate"
                    >
                      {issue.title}
                    </Link>
                    <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                      issue.state === "open"
                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                        : "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
                    }`}>
                      {issue.state}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-zinc-500 dark:text-zinc-400">
                    <span>#{issue.issueNumber}</span>
                    <span>by {issue.authorLogin}</span>
                    <span>{new Date(issue.createdAt).toLocaleDateString("ja-JP")}</span>
                  </div>
                  {hasLabels(issue.labels) && (
                    <div className="flex items-center gap-2 mt-2">
                      {getLabelsArray(issue.labels).map((label) => (
                        <span
                          key={label}
                          className="px-2 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  )}
                  {issue.body && (
                    <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 line-clamp-2">
                      {issue.body}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {issue.linkedTaskId ? (
                    <Link
                      href={getTaskDetailPath(issue.linkedTaskId)}
                      className="flex items-center gap-1 px-3 py-1.5 text-sm text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors"
                    >
                      <ArrowRightCircle className="w-4 h-4" />
                      タスクを見る
                    </Link>
                  ) : (
                    <button
                      onClick={() => createTaskFromIssue(issue.id)}
                      disabled={creatingTask === issue.id}
                      className="flex items-center gap-1 px-3 py-1.5 text-sm text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {creatingTask === issue.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Plus className="w-4 h-4" />
                      )}
                      タスク化
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
