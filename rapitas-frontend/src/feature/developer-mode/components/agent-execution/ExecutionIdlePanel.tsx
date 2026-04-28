'use client';
// ExecutionIdlePanel

import React from 'react';
import { Play, Bot, GitBranch, Sparkles, ChevronDown, ChevronUp, Settings } from 'lucide-react';
import { AgentSwitcher } from '@/components/ui/AgentSwitcher';
import { AgentKnowledgeContext } from '@/feature/intelligence/components/AgentKnowledgeContext';

type Props = {
  taskId: number;
  /** Whether the panel is expanded to show options. */
  isExpanded: boolean;
  /** Toggle expanded state. */
  setIsExpanded: (v: boolean) => void;
  /** Whether the advanced options sub-panel is open. */
  showOptions: boolean;
  /** Toggle the advanced options sub-panel. */
  setShowOptions: (v: boolean) => void;
  /** Whether the optimized prompt badge should be shown. */
  hasOptimizedPrompt: boolean;
  /** Whether an execution is currently running (disables the execute button). */
  isExecuting: boolean;
  /** Currently selected agent config ID. */
  selectedAgentId: number | null;
  /** Update the selected agent. */
  setSelectedAgentId: (id: number | null) => void;
  /** Custom instruction text. */
  instruction: string;
  /** Update the instruction. */
  setInstruction: (v: string) => void;
  /** Branch name override. */
  branchName: string;
  /** Update the branch name. */
  setBranchName: (v: string) => void;
  /** Rendered log panel (passed from parent). */
  logsNode: React.ReactNode;
  /** Run the agent execution. */
  onExecute: () => void;
};

/**
 * Idle (pre-execution) state panel with collapsible options form.
 *
 * @param props - See Props type
 */
export function ExecutionIdlePanel({
  taskId,
  isExpanded,
  setIsExpanded,
  showOptions,
  setShowOptions,
  hasOptimizedPrompt,
  isExecuting,
  selectedAgentId,
  setSelectedAgentId,
  instruction,
  setInstruction,
  branchName,
  setBranchName,
  logsNode,
  onExecute,
}: Props) {
  return (
    <div className="bg-white dark:bg-indigo-dark-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      {/* Header / toggle row */}
      <div
        className="px-4 py-3 bg-linear-to-r from-violet-50 to-purple-50 dark:from-violet-900/20 dark:to-purple-900/20 border-b border-zinc-200 dark:border-zinc-700 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-violet-600 dark:text-violet-400" />
            <span className="font-semibold text-zinc-900 dark:text-zinc-50">
              AI エージェント実行
            </span>
            {hasOptimizedPrompt && (
              <span className="flex items-center gap-1 px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-xs">
                <Sparkles className="w-3 h-3" />
                最適化済み
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!isExpanded && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onExecute();
                }}
                disabled={isExecuting}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Play className="w-4 h-4" />
                実行
              </button>
            )}
            {isExpanded ? (
              <ChevronUp className="w-4 h-4 text-zinc-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-zinc-400" />
            )}
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="p-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
            Claude
            Codeがこのタスクを自動で実行します。完了後、差分をレビューしてコミットやPRを作成できます。
          </p>

          {hasOptimizedPrompt && (
            <div className="flex items-center gap-2 px-3 py-2 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800 mb-4">
              <Sparkles className="w-4 h-4 text-green-600 dark:text-green-400" />
              <span className="text-sm text-green-700 dark:text-green-300">
                最適化されたプロンプトを使用して実行します。
              </span>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowOptions(!showOptions)}
              className="flex-1 h-11 flex items-center justify-between px-4 bg-zinc-50 dark:bg-indigo-dark-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-zinc-400" />
                <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                  詳細オプション
                </span>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ${
                  showOptions ? 'rotate-180' : ''
                }`}
              />
            </button>

            <button
              onClick={onExecute}
              disabled={isExecuting}
              className="h-11 flex items-center gap-2 px-6 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              <Play className="w-4 h-4" />
              実行
            </button>
          </div>

          {showOptions && (
            <div className="mt-3 space-y-4 p-4 bg-zinc-50 dark:bg-zinc-800/30 rounded-lg border border-zinc-200 dark:border-zinc-700 animate-in slide-in-from-top-1 duration-200">
              <div>
                <AgentSwitcher
                  selectedAgentId={selectedAgentId}
                  onSelect={setSelectedAgentId}
                  size="md"
                  showLabel={true}
                />
              </div>

              <div>
                <label className="flex text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                  追加の実行指示（任意）
                </label>
                <textarea
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="例: TypeScriptの型を厳密に定義してください。テストも作成してください。"
                  rows={3}
                  className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all resize-none"
                />
              </div>

              <div>
                <label className="flex text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2 items-center gap-2">
                  <GitBranch className="w-4 h-4" />
                  作業ブランチ名（空欄で自動生成）
                </label>
                <input
                  type="text"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  placeholder="AIが自動で適切なブランチ名を生成します"
                  className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-all"
                />
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  指定しない場合、AIがタスク内容を基に適切なブランチ名を自動生成します。
                </p>
              </div>
            </div>
          )}

          <div className="mt-3">
            <AgentKnowledgeContext taskId={taskId} />
          </div>

          {logsNode && <div className="mt-4">{logsNode}</div>}
        </div>
      )}
    </div>
  );
}
