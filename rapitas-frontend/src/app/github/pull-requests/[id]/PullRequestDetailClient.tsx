"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  GitPullRequest,
  GitMerge,
  XCircle,
  MessageSquare,
  CheckCircle2,
  AlertCircle,
  FileCode,
  ExternalLink,
  Send,
  Loader2,
  ChevronDown,
  ChevronRight,
  Plus,
  Minus,
} from "lucide-react";
import type { GitHubPullRequest, FileDiff } from "@/types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

export default function PullRequestDetailClient() {
  const params = useParams();
  const id = params.id as string;

  const [pr, setPr] = useState<GitHubPullRequest | null>(null);
  const [diff, setDiff] = useState<FileDiff[]>([]);
  const [activeTab, setActiveTab] = useState<"conversation" | "files">("conversation");
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [commenting, setCommenting] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [reviewAction, setReviewAction] = useState<"approve" | "request_changes" | null>(null);

  useEffect(() => {
    fetchPRData();
  }, [id]);

  const fetchPRData = async () => {
    setLoading(true);
    try {
      const [prRes, diffRes] = await Promise.all([
        fetch(`${API_BASE_URL}/github/pull-requests/${id}`),
        fetch(`${API_BASE_URL}/github/pull-requests/${id}/diff`),
      ]);

      if (prRes.ok) {
        setPr(await prRes.json());
      }
      if (diffRes.ok) {
        setDiff(await diffRes.json());
      }
    } catch (error) {
      console.error("Failed to fetch PR:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleComment = async () => {
    if (!commentBody.trim()) return;

    setCommenting(true);
    try {
      await fetch(`${API_BASE_URL}/github/pull-requests/${id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: commentBody }),
      });
      setCommentBody("");
      await fetchPRData();
    } catch (error) {
      console.error("Failed to comment:", error);
    } finally {
      setCommenting(false);
    }
  };

  const handleReview = async (action: "approve" | "request_changes") => {
    setReviewAction(action);
    try {
      const endpoint = action === "approve" ? "approve" : "request-changes";
      await fetch(`${API_BASE_URL}/github/pull-requests/${id}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: commentBody || undefined }),
      });
      setCommentBody("");
      await fetchPRData();
    } catch (error) {
      console.error("Failed to review:", error);
    } finally {
      setReviewAction(null);
    }
  };

  const toggleFile = (filename: string) => {
    setExpandedFiles((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(filename)) {
        newSet.delete(filename);
      } else {
        newSet.add(filename);
      }
      return newSet;
    });
  };

  const getStatusIcon = (state: string) => {
    switch (state) {
      case "open":
        return <GitPullRequest className="w-6 h-6 text-green-500" />;
      case "merged":
        return <GitMerge className="w-6 h-6 text-purple-500" />;
      case "closed":
        return <XCircle className="w-6 h-6 text-red-500" />;
      default:
        return <GitPullRequest className="w-6 h-6" />;
    }
  };

  const getReviewIcon = (state: string) => {
    switch (state) {
      case "APPROVED":
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case "CHANGES_REQUESTED":
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      default:
        return <MessageSquare className="w-4 h-4 text-zinc-400" />;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (!pr) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <p className="text-center text-zinc-500 dark:text-zinc-400">PRが見つかりません</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* ヘッダー */}
      <div className="flex items-start gap-4 mb-6">
        <Link
          href="/github/pull-requests"
          className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        {getStatusIcon(pr.state)}
        <div className="flex-1">
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
            {pr.title}
            <span className="ml-2 text-zinc-400 font-normal">#{pr.prNumber}</span>
          </h1>
          <div className="flex items-center gap-3 mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            <span>by {pr.authorLogin}</span>
            <span className="font-mono text-xs bg-zinc-100 dark:bg-zinc-700 px-2 py-1 rounded">
              {pr.headBranch} → {pr.baseBranch}
            </span>
            <a
              href={pr.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              <ExternalLink className="w-3 h-3" />
              GitHubで開く
            </a>
          </div>
        </div>
      </div>

      {/* タブ */}
      <div className="flex items-center gap-1 border-b border-zinc-200 dark:border-zinc-700 mb-6">
        <button
          onClick={() => setActiveTab("conversation")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "conversation"
              ? "border-indigo-500 text-indigo-600 dark:text-indigo-400"
              : "border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
          }`}
        >
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            会話
            {(pr.reviews?.length || 0) + (pr.comments?.length || 0) > 0 && (
              <span className="px-1.5 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-700 rounded">
                {(pr.reviews?.length || 0) + (pr.comments?.length || 0)}
              </span>
            )}
          </div>
        </button>
        <button
          onClick={() => setActiveTab("files")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "files"
              ? "border-indigo-500 text-indigo-600 dark:text-indigo-400"
              : "border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
          }`}
        >
          <div className="flex items-center gap-2">
            <FileCode className="w-4 h-4" />
            ファイル変更
            {diff.length > 0 && (
              <span className="px-1.5 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-700 rounded">
                {diff.length}
              </span>
            )}
          </div>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* メインコンテンツ */}
        <div className="lg:col-span-2">
          {activeTab === "conversation" ? (
            <div className="space-y-4">
              {/* PR説明 */}
              {pr.body && (
                <div className="p-4 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
                  <div className="prose dark:prose-invert max-w-none text-sm">
                    {pr.body}
                  </div>
                </div>
              )}

              {/* レビュー */}
              {pr.reviews?.map((review) => (
                <div
                  key={review.id}
                  className="p-4 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700"
                >
                  <div className="flex items-center gap-2 mb-2">
                    {getReviewIcon(review.state)}
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {review.authorLogin}
                    </span>
                    <span className={`px-2 py-0.5 text-xs rounded ${
                      review.state === "APPROVED"
                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                        : review.state === "CHANGES_REQUESTED"
                        ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                        : "bg-zinc-100 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300"
                    }`}>
                      {review.state === "APPROVED" ? "Approved" : review.state === "CHANGES_REQUESTED" ? "Changes requested" : "Commented"}
                    </span>
                    <span className="text-xs text-zinc-400">
                      {new Date(review.submittedAt).toLocaleString("ja-JP")}
                    </span>
                  </div>
                  {review.body && (
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">{review.body}</p>
                  )}
                </div>
              ))}

              {/* コメント */}
              {pr.comments?.map((comment) => (
                <div
                  key={comment.id}
                  className="p-4 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <MessageSquare className="w-4 h-4 text-zinc-400" />
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {comment.authorLogin}
                    </span>
                    {comment.path && (
                      <span className="text-xs font-mono bg-zinc-100 dark:bg-zinc-700 px-1.5 py-0.5 rounded">
                        {comment.path}:{comment.line}
                      </span>
                    )}
                    <span className="text-xs text-zinc-400">
                      {new Date(comment.createdAt).toLocaleString("ja-JP")}
                    </span>
                  </div>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">{comment.body}</p>
                </div>
              ))}

              {/* コメント入力 */}
              <div className="p-4 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
                <textarea
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  placeholder="コメントを入力..."
                  rows={3}
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                />
                <div className="flex items-center justify-between mt-3">
                  <div className="flex items-center gap-2">
                    {pr.state === "open" && (
                      <>
                        <button
                          onClick={() => handleReview("approve")}
                          disabled={reviewAction !== null}
                          className="flex items-center gap-2 px-3 py-1.5 text-sm text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          承認
                        </button>
                        <button
                          onClick={() => handleReview("request_changes")}
                          disabled={reviewAction !== null || !commentBody.trim()}
                          className="flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
                        >
                          <AlertCircle className="w-4 h-4" />
                          変更をリクエスト
                        </button>
                      </>
                    )}
                  </div>
                  <button
                    onClick={handleComment}
                    disabled={commenting || !commentBody.trim()}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                  >
                    {commenting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    コメント
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {diff.map((file) => (
                <div
                  key={file.filename}
                  className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden"
                >
                  <button
                    onClick={() => toggleFile(file.filename)}
                    className="w-full flex items-center justify-between p-3 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {expandedFiles.has(file.filename) ? (
                        <ChevronDown className="w-4 h-4 text-zinc-400" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-zinc-400" />
                      )}
                      <FileCode className="w-4 h-4 text-zinc-400" />
                      <span className="font-mono text-sm text-zinc-900 dark:text-zinc-100">
                        {file.filename}
                      </span>
                      <span className={`px-1.5 py-0.5 text-xs rounded ${
                        file.status === "added"
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : file.status === "removed"
                          ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                      }`}>
                        {file.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-green-600 dark:text-green-400 flex items-center gap-0.5">
                        <Plus className="w-3 h-3" />{file.additions}
                      </span>
                      <span className="text-red-600 dark:text-red-400 flex items-center gap-0.5">
                        <Minus className="w-3 h-3" />{file.deletions}
                      </span>
                    </div>
                  </button>
                  {expandedFiles.has(file.filename) && file.patch && (
                    <div className="border-t border-zinc-200 dark:border-zinc-700">
                      <pre className="p-4 text-xs font-mono overflow-x-auto bg-zinc-50 dark:bg-zinc-900">
                        {file.patch.split("\n").map((line, i) => (
                          <div
                            key={i}
                            className={`${
                              line.startsWith("+") && !line.startsWith("+++")
                                ? "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300"
                                : line.startsWith("-") && !line.startsWith("---")
                                ? "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300"
                                : line.startsWith("@@")
                                ? "bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300"
                                : "text-zinc-600 dark:text-zinc-400"
                            }`}
                          >
                            {line}
                          </div>
                        ))}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* サイドバー */}
        <div className="space-y-4">
          {/* ステータス */}
          <div className="p-4 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
            <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-3">ステータス</h3>
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
              pr.state === "open"
                ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400"
                : pr.state === "merged"
                ? "bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400"
                : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400"
            }`}>
              {getStatusIcon(pr.state)}
              <span className="font-medium capitalize">{pr.state}</span>
            </div>
          </div>

          {/* レビュー要約 */}
          {pr.reviews && pr.reviews.length > 0 && (
            <div className="p-4 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
              <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-3">レビュー</h3>
              <div className="space-y-2">
                {pr.reviews.map((review) => (
                  <div key={review.id} className="flex items-center gap-2 text-sm">
                    {getReviewIcon(review.state)}
                    <span className="text-zinc-600 dark:text-zinc-400">{review.authorLogin}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 変更統計 */}
          <div className="p-4 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
            <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-3">変更</h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-zinc-500 dark:text-zinc-400">ファイル数</span>
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{diff.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500 dark:text-zinc-400">追加</span>
                <span className="font-medium text-green-600 dark:text-green-400">
                  +{diff.reduce((sum, f) => sum + f.additions, 0)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500 dark:text-zinc-400">削除</span>
                <span className="font-medium text-red-600 dark:text-red-400">
                  -{diff.reduce((sum, f) => sum + f.deletions, 0)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
