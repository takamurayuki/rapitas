"use client";

import { useState } from "react";
import {
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronRight,
  Terminal,
  GitBranch,
  GitPullRequest,
  Loader2,
  AlertCircle,
  Clock,
  Check,
} from "lucide-react";
import { DiffViewer } from "./DiffViewer";
import type { FileDiff, AgentExecution } from "@/types";

type ExecutionReviewPanelProps = {
  execution?: AgentExecution;
  files: FileDiff[];
  executionLog?: string;
  status: "pending" | "running" | "completed" | "failed";
  onApprove: (commitMessage: string, baseBranch: string) => Promise<void>;
  onReject: () => Promise<void>;
  isProcessing?: boolean;
  error?: string | null;
  defaultBranch?: string;
};

export function ExecutionReviewPanel({
  execution,
  files,
  executionLog,
  status,
  onApprove,
  onReject,
  isProcessing = false,
  error,
  defaultBranch = "main",
}: ExecutionReviewPanelProps) {
  const [showLog, setShowLog] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [baseBranch, setBaseBranch] = useState(defaultBranch);
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);

  const handleApprove = async () => {
    if (!commitMessage.trim()) return;

    setIsApproving(true);
    try {
      await onApprove(commitMessage.trim(), baseBranch);
    } finally {
      setIsApproving(false);
    }
  };

  const handleReject = async () => {
    setIsRejecting(true);
    try {
      await onReject();
    } finally {
      setIsRejecting(false);
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case "pending":
        return <Clock className="w-5 h-5 text-amber-500" />;
      case "running":
        return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
      case "completed":
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case "failed":
        return <XCircle className="w-5 h-5 text-red-500" />;
    }
  };

  const getStatusLabel = () => {
    switch (status) {
      case "pending":
        return "保留中";
      case "running":
        return "実行中";
      case "completed":
        return "完了";
      case "failed":
        return "失敗";
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case "pending":
        return "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300";
      case "running":
        return "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300";
      case "completed":
        return "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300";
      case "failed":
        return "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300";
    }
  };

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          {getStatusIcon()}
          <div>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">
              実行結果レビュー
            </h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              変更内容を確認して承認またはキャンセル
            </p>
          </div>
        </div>
        <span
          className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor()}`}
        >
          {getStatusLabel()}
        </span>
      </div>

      {/* Error Message */}
      {error && (
        <div className="px-6 py-4 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        </div>
      )}

      {/* Execution Log */}
      {executionLog && (
        <div className="border-b border-zinc-200 dark:border-zinc-800">
          <button
            onClick={() => setShowLog(!showLog)}
            className="w-full flex items-center gap-3 px-6 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors"
          >
            {showLog ? (
              <ChevronDown className="w-4 h-4 text-zinc-400" />
            ) : (
              <ChevronRight className="w-4 h-4 text-zinc-400" />
            )}
            <Terminal className="w-4 h-4 text-zinc-400" />
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              実行ログ
            </span>
          </button>
          {showLog && (
            <div className="px-6 pb-4">
              <pre className="p-4 bg-zinc-900 dark:bg-zinc-950 rounded-lg text-xs font-mono text-zinc-300 overflow-x-auto max-h-64 overflow-y-auto">
                {executionLog}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Diff Viewer */}
      <div className="p-6 border-b border-zinc-200 dark:border-zinc-800">
        <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-4">
          変更内容
        </h4>
        <DiffViewer files={files} />
      </div>

      {/* Commit & PR Options */}
      {status === "completed" && files.length > 0 && (
        <div className="p-6 space-y-4 border-b border-zinc-200 dark:border-zinc-800">
          {/* Commit Message */}
          <div>
            <label
              htmlFor="commitMessage"
              className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2"
            >
              <Check className="w-4 h-4" />
              コミットメッセージ
            </label>
            <textarea
              id="commitMessage"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder="feat: 機能の説明..."
              rows={3}
              className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all resize-none"
            />
          </div>

          {/* Base Branch */}
          <div>
            <label
              htmlFor="baseBranch"
              className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2"
            >
              <GitBranch className="w-4 h-4" />
              ベースブランチ
            </label>
            <input
              type="text"
              id="baseBranch"
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              placeholder="main"
              className="w-full px-4 py-2.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all"
            />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 px-6 py-4 bg-zinc-50 dark:bg-zinc-800/50">
        <button
          onClick={handleReject}
          disabled={isProcessing || isApproving || isRejecting}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors disabled:opacity-50"
        >
          {isRejecting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <XCircle className="w-4 h-4" />
          )}
          変更を破棄
        </button>
        <button
          onClick={handleApprove}
          disabled={
            isProcessing ||
            isApproving ||
            isRejecting ||
            !commitMessage.trim() ||
            status !== "completed" ||
            files.length === 0
          }
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isApproving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <GitPullRequest className="w-4 h-4" />
          )}
          コミット & PR作成
        </button>
      </div>
    </div>
  );
}

export default ExecutionReviewPanel;
