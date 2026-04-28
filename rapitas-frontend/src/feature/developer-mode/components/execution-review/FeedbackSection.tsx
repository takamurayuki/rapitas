'use client';
// FeedbackSection

import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Plus,
  X,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import type { FileDiff, ReviewComment } from '@/types';

type FeedbackSectionProps = {
  files: FileDiff[];
  onRequestChanges?: (feedback: string, comments: ReviewComment[]) => Promise<void>;
};

/**
 * Returns the Japanese display label for a review comment type.
 *
 * @param type - Comment type / コメントタイプ
 * @returns Japanese label string / 日本語ラベル
 */
function getCommentTypeLabel(type: ReviewComment['type']): string {
  switch (type) {
    case 'change_request':
      return '修正依頼';
    case 'comment':
      return 'コメント';
    case 'question':
      return '質問';
  }
}

/**
 * Returns the Tailwind color classes for a review comment type badge.
 *
 * @param type - Comment type / コメントタイプ
 * @returns Tailwind class string / Tailwindクラス文字列
 */
function getCommentTypeColor(type: ReviewComment['type']): string {
  switch (type) {
    case 'change_request':
      return 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300';
    case 'comment':
      return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300';
    case 'question':
      return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300';
  }
}

/**
 * Feedback and change-request panel shown after a completed execution.
 *
 * @param files - Changed files for the per-file comment target selector / コメント対象ファイルリスト
 * @param onRequestChanges - Callback to submit feedback and re-run the agent / フィードバック送信コールバック
 */
export function FeedbackSection({ files, onRequestChanges }: FeedbackSectionProps) {
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [reviewComments, setReviewComments] = useState<ReviewComment[]>([]);
  const [newCommentFile, setNewCommentFile] = useState('');
  const [newCommentContent, setNewCommentContent] = useState('');
  const [newCommentType, setNewCommentType] = useState<ReviewComment['type']>('change_request');
  const [isRequestingChanges, setIsRequestingChanges] = useState(false);

  const handleRequestChanges = async () => {
    if (!feedbackText.trim() && reviewComments.length === 0) return;
    if (!onRequestChanges) return;

    setIsRequestingChanges(true);
    try {
      await onRequestChanges(feedbackText.trim(), reviewComments);
      setFeedbackText('');
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
    setNewCommentContent('');
    setNewCommentFile('');
  };

  const removeComment = (id: string) => {
    setReviewComments(reviewComments.filter((c) => c.id !== id));
  };

  return (
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
          {reviewComments.length > 0 && (
            <div className="space-y-2">
              <h5 className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase">
                追加済みのコメント
              </h5>
              {reviewComments.map((comment) => (
                <div
                  key={comment.id}
                  className="flex items-start gap-3 p-3 bg-zinc-50 dark:bg-indigo-dark-800/50 rounded-lg"
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
                    <p className="text-sm text-zinc-700 dark:text-zinc-300">{comment.content}</p>
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

          <div className="space-y-3 p-4 bg-zinc-50 dark:bg-indigo-dark-800/30 rounded-lg border border-zinc-200 dark:border-zinc-700">
            <div className="flex items-center gap-2">
              <select
                value={newCommentType}
                onChange={(e) => setNewCommentType(e.target.value as ReviewComment['type'])}
                className="px-3 py-1.5 bg-white dark:bg-indigo-dark-800 border border-zinc-300 dark:border-zinc-600 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20"
              >
                <option value="change_request">修正依頼</option>
                <option value="comment">コメント</option>
                <option value="question">質問</option>
              </select>
              <select
                value={newCommentFile}
                onChange={(e) => setNewCommentFile(e.target.value)}
                className="flex-1 px-3 py-1.5 bg-white dark:bg-indigo-dark-800 border border-zinc-300 dark:border-zinc-600 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/20"
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
                className="flex-1 px-3 py-2 bg-white dark:bg-indigo-dark-800 border border-zinc-300 dark:border-zinc-600 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 resize-none"
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

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              全体的なフィードバック（任意）
            </label>
            <textarea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="実装全体に対するフィードバックや追加の指示を入力..."
              rows={3}
              className="w-full px-4 py-3 bg-white dark:bg-indigo-dark-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all resize-none"
            />
          </div>

          {onRequestChanges && (
            <button
              onClick={handleRequestChanges}
              disabled={
                isRequestingChanges || (!feedbackText.trim() && reviewComments.length === 0)
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
  );
}
