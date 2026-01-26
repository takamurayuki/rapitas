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
  FileText,
  Timer,
  MessageSquare,
  RefreshCw,
  Plus,
  X,
} from "lucide-react";
import { DiffViewer } from "./DiffViewer";
import type { FileDiff, AgentExecution, ReviewComment } from "@/types";
import ReactMarkdown from "react-markdown";

type ExecutionReviewPanelProps = {
  execution?: AgentExecution;
  files: FileDiff[];
  executionLog?: string;
  status: "pending" | "running" | "completed" | "failed";
  onApprove: (commitMessage: string, baseBranch: string) => Promise<void>;
  onReject: () => Promise<void>;
  onRequestChanges?: (
    feedback: string,
    comments: ReviewComment[],
  ) => Promise<void>;
  isProcessing?: boolean;
  error?: string | null;
  defaultBranch?: string;
  implementationSummary?: string;
  executionTimeMs?: number;
  taskId?: number;
};

export function ExecutionReviewPanel({
  execution,
  files,
  executionLog,
  status,
  onApprove,
  onReject,
  onRequestChanges,
  isProcessing = false,
  error,
  defaultBranch = "main",
  implementationSummary,
  executionTimeMs,
  taskId,
}: ExecutionReviewPanelProps) {
  const [showLog, setShowLog] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [baseBranch, setBaseBranch] = useState(defaultBranch);
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [isRequestingChanges, setIsRequestingChanges] = useState(false);
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [reviewComments, setReviewComments] = useState<ReviewComment[]>([]);
  const [newCommentFile, setNewCommentFile] = useState("");
  const [newCommentContent, setNewCommentContent] = useState("");
  const [newCommentType, setNewCommentType] =
    useState<ReviewComment["type"]>("change_request");

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

  const handleRequestChanges = async () => {
    if (!feedbackText.trim() && reviewComments.length === 0) return;
    if (!onRequestChanges) return;

    setIsRequestingChanges(true);
    try {
      await onRequestChanges(feedbackText.trim(), reviewComments);
      setFeedbackText("");
      setReviewComments([]);
      setShowFeedbackForm(false);
    } finally {
      setIsRequestingChanges(false);
    }
  };

  const addComment = () => {
    if (!newCommentContent.trim()) return;

    const comment: ReviewComment = {
      id: `comment-${Date.now()}`,
      file: newCommentFile || undefined,
      content: newCommentContent.trim(),
      type: newCommentType,
    };

    setReviewComments([...reviewComments, comment]);
    setNewCommentContent("");
    setNewCommentFile("");
  };

  const removeComment = (id: string) => {
    setReviewComments(reviewComments.filter((c) => c.id !== id));
  };

  const getCommentTypeLabel = (type: ReviewComment["type"]) => {
    switch (type) {
      case "change_request":
        return "修正依頼";
      case "comment":
        return "コメント";
      case "question":
        return "質問";
    }
  };

  const getCommentTypeColor = (type: ReviewComment["type"]) => {
    switch (type) {
      case "change_request":
        return "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300";
      case "comment":
        return "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300";
      case "question":
        return "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300";
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
      {/* Error Message */}
      {error && (
        <div className="px-6 py-4 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        </div>
      )}

      {/* Implementation Summary */}
      {implementationSummary && (
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-violet-100 dark:bg-violet-900/30 rounded-lg shrink-0">
              <FileText className="w-4 h-4 text-violet-600 dark:text-violet-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                実装内容の説明
              </h4>
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{implementationSummary}</ReactMarkdown>
              </div>
            </div>
          </div>
          {executionTimeMs && (
            <div className="flex items-center gap-2 mt-3 text-xs text-zinc-500 dark:text-zinc-400">
              <Timer className="w-3.5 h-3.5" />
              <span>実行時間: {Math.round(executionTimeMs / 1000)}秒</span>
            </div>
          )}
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

      {/* Feedback / Change Request Section */}
      {status === "completed" && files.length > 0 && (
        <div className="border-b border-zinc-200 dark:border-zinc-800">
          <button
            onClick={() => setShowFeedbackForm(!showFeedbackForm)}
            className="w-full flex items-center gap-3 px-6 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors"
          >
            {showFeedbackForm ? (
              <ChevronDown className="w-4 h-4 text-zinc-400" />
            ) : (
              <ChevronRight className="w-4 h-4 text-zinc-400" />
            )}
            <MessageSquare className="w-4 h-4 text-orange-500" />
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              修正を依頼する / コメントを追加
            </span>
            {reviewComments.length > 0 && (
              <span className="px-2 py-0.5 bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 rounded-full text-xs font-medium">
                {reviewComments.length}
              </span>
            )}
          </button>

          {showFeedbackForm && (
            <div className="px-6 pb-4 space-y-4">
              {/* 既存のコメント一覧 */}
              {reviewComments.length > 0 && (
                <div className="space-y-2">
                  <h5 className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase">
                    追加済みのコメント
                  </h5>
                  {reviewComments.map((comment) => (
                    <div
                      key={comment.id}
                      className="flex items-start gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg"
                    >
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ${getCommentTypeColor(comment.type)}`}
                      >
                        {getCommentTypeLabel(comment.type)}
                      </span>
                      <div className="flex-1 min-w-0">
                        {comment.file && (
                          <p className="text-xs font-mono text-violet-600 dark:text-violet-400 mb-1">
                            {comment.file}
                          </p>
                        )}
                        <p className="text-sm text-zinc-700 dark:text-zinc-300">
                          {comment.content}
                        </p>
                      </div>
                      <button
                        onClick={() => removeComment(comment.id)}
                        className="p-1 text-zinc-400 hover:text-red-500 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* 新しいコメント追加フォーム */}
              <div className="space-y-3 p-4 bg-zinc-50 dark:bg-zinc-800/30 rounded-lg border border-zinc-200 dark:border-zinc-700">
                <div className="flex items-center gap-2">
                  <select
                    value={newCommentType}
                    onChange={(e) =>
                      setNewCommentType(e.target.value as ReviewComment["type"])
                    }
                    className="px-3 py-1.5 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                  >
                    <option value="change_request">修正依頼</option>
                    <option value="comment">コメント</option>
                    <option value="question">質問</option>
                  </select>
                  <select
                    value={newCommentFile}
                    onChange={(e) => setNewCommentFile(e.target.value)}
                    className="flex-1 px-3 py-1.5 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                  >
                    <option value="">全体に対して</option>
                    {files.map((file) => (
                      <option key={file.filename} value={file.filename}>
                        {file.filename}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-start gap-2">
                  <textarea
                    value={newCommentContent}
                    onChange={(e) => setNewCommentContent(e.target.value)}
                    placeholder="具体的な修正内容や質問を入力..."
                    rows={2}
                    className="flex-1 px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 resize-none"
                  />
                  <button
                    onClick={addComment}
                    disabled={!newCommentContent.trim()}
                    className="flex items-center gap-1 px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Plus className="w-4 h-4" />
                    追加
                  </button>
                </div>
              </div>

              {/* 全体的なフィードバック */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                  全体的なフィードバック（任意）
                </label>
                <textarea
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  placeholder="実装全体に対するフィードバックや追加の指示を入力..."
                  rows={3}
                  className="w-full px-4 py-3 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all resize-none"
                />
              </div>

              {/* 修正依頼ボタン */}
              {onRequestChanges && (
                <button
                  onClick={handleRequestChanges}
                  disabled={
                    isRequestingChanges ||
                    (!feedbackText.trim() && reviewComments.length === 0)
                  }
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isRequestingChanges ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  フィードバックを送信して再実行
                </button>
              )}
            </div>
          )}
        </div>
      )}

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
