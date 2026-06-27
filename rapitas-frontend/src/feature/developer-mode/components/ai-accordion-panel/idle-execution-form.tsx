'use client';
/**
 * IdleExecutionForm
 *
 * Compact idle-state execution form for the AI accordion panel: an inline
 * instruction input plus a collapsible "詳細設定" section for branch / base
 * branch. Presentational only — all state is lifted to the parent except the
 * local collapse toggle.
 */

import { useState } from 'react';
import { Sparkles, GitBranch, ChevronDown, ChevronUp } from 'lucide-react';

export type IdleExecutionFormProps = {
  optimizedPrompt?: string | null;
  instruction: string;
  branchName: string;
  baseBranch: string;
  baseBranches: string[];
  onSetInstruction: (v: string) => void;
  onSetBranchName: (v: string) => void;
  onSetBaseBranch: (v: string) => void;
};

/**
 * Compact idle-state execution form with inline instruction + collapsible details.
 *
 * @param props - Lifted instruction/branch state and setters / 持ち上げた指示・ブランチ状態とセッター
 */
export function IdleExecutionForm({
  optimizedPrompt,
  instruction,
  branchName,
  baseBranch,
  baseBranches,
  onSetInstruction,
  onSetBranchName,
  onSetBaseBranch,
}: IdleExecutionFormProps) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="space-y-2">
      {/* Inline instruction input */}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={instruction}
          onChange={(e) => onSetInstruction(e.target.value)}
          placeholder="追加指示があれば入力...（任意）"
          className="flex-1 px-2.5 py-1.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-xs focus:outline-none focus:border-indigo-400"
          aria-label="追加の実装指示"
        />
      </div>

      {/* Status badges */}
      {optimizedPrompt && (
        <div className="flex items-center gap-1.5 px-1">
          <Sparkles className="w-2.5 h-2.5 text-green-500" />
          <span className="text-[10px] text-green-600 dark:text-green-400">
            最適化プロンプト適用済み
          </span>
        </div>
      )}

      {/* Collapsible details */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="flex items-center gap-1 px-1 text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
      >
        {showDetails ? (
          <ChevronUp className="w-2.5 h-2.5" />
        ) : (
          <ChevronDown className="w-2.5 h-2.5" />
        )}
        詳細設定
      </button>

      {showDetails && (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-2.5 space-y-2">
          <div>
            <label className="flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400 mb-1">
              <GitBranch className="w-2.5 h-2.5" />
              ブランチ名
              <span className="text-zinc-400 dark:text-zinc-500">（空欄で自動生成）</span>
            </label>
            <input
              type="text"
              value={branchName}
              onChange={(e) => onSetBranchName(e.target.value)}
              placeholder="自動生成されます"
              className="w-full px-2 py-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-[10px] font-mono focus:outline-none focus:border-indigo-400"
              aria-label="ブランチ名"
            />
          </div>

          {/* Base branch: the branch the new feature branch is cut from and the
              PR targets. Populated with the repo's origin branches; defaults to
              the theme's default branch. */}
          <div>
            <label className="flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400 mb-1">
              <GitBranch className="w-2.5 h-2.5" />
              ベースブランチ
              <span className="text-zinc-400 dark:text-zinc-500">（PR作成先 / 分岐元）</span>
            </label>
            {baseBranches.length > 0 ? (
              <select
                value={baseBranch}
                onChange={(e) => onSetBaseBranch(e.target.value)}
                className="w-full px-2 py-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-[10px] font-mono focus:outline-none focus:border-indigo-400"
                aria-label="ベースブランチ"
              >
                {baseBranches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={baseBranch}
                onChange={(e) => onSetBaseBranch(e.target.value)}
                placeholder="develop"
                className="w-full px-2 py-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-[10px] font-mono focus:outline-none focus:border-indigo-400"
                aria-label="ベースブランチ"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
