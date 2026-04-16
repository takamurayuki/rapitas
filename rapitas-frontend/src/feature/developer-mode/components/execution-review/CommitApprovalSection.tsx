'use client';
// CommitApprovalSection

import { useState } from 'react';
import {
  Check,
  GitBranch,
  GitPullRequest,
  XCircle,
  Loader2,
} from 'lucide-react';

type CommitApprovalSectionProps = {
  /** Whether the execution has completed with file changes — shows full commit form when true */
  isReadyToApprove: boolean;
  defaultBranch?: string;
  isProcessing?: boolean;
  onApprove: (commitMessage: string, baseBranch: string) => Promise<void>;
  onReject: () => Promise<void>;
};

/**
 * Commit options and approve/reject action footer for the execution review panel.
 *
 * @param isReadyToApprove - Show commit form and enable approve button / コミットフォームと承認ボタンを表示
 * @param defaultBranch - Pre-filled base branch name / 事前入力されるベースブランチ名
 * @param isProcessing - When true, all action buttons are disabled / trueの場合すべてのボタンを無効化
 * @param onApprove - Called with commit message and base branch when approved / 承認時に呼び出す
 * @param onReject - Called when the user discards changes / 変更を破棄する際に呼び出す
 */
export function CommitApprovalSection({
  isReadyToApprove,
  defaultBranch = 'main',
  isProcessing = false,
  onApprove,
  onReject,
}: CommitApprovalSectionProps) {
  const [commitMessage, setCommitMessage] = useState('');
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

  return (
    <>
      {/* Commit & PR Options — visible only when execution completed with changes */}
      {isReadyToApprove && (
        <div className="p-6 space-y-4 border-b border-zinc-200 dark:border-zinc-800">
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
              className="w-full px-4 py-3 bg-zinc-50 dark:bg-indigo-dark-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all resize-none"
            />
          </div>

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
              className="w-full px-4 py-2.5 bg-zinc-50 dark:bg-indigo-dark-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all"
            />
          </div>
        </div>
      )}

      {/* Actions — always visible */}
      <div className="flex items-center justify-end gap-3 px-6 py-4 bg-zinc-50 dark:bg-indigo-dark-800/50">
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
        {isReadyToApprove && (
          <button
            onClick={handleApprove}
            disabled={
              isProcessing ||
              isApproving ||
              isRejecting ||
              !commitMessage.trim()
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
        )}
      </div>
    </>
  );
}
