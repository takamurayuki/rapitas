'use client';
// WorkflowFileContent

import { Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { WorkflowTab } from './workflow-viewer-utils';

interface WorkflowFile {
  exists: boolean;
  content?: string | null;
  lastModified?: string | null;
  size?: number | null;
}

interface WorkflowFileContentProps {
  isLoading: boolean;
  activeFile: WorkflowFile | null;
  activeTabConfig: WorkflowTab;
  /** Whether to show the inline plan-approval CTA (plan tab + plan_created status) */
  showApprovalButton: boolean;
  /** Whether to show the inline verification-complete CTA */
  showCompleteButton: boolean;
  isRefetching: boolean;
  onRefetch: () => void;
  onPlanApprovalRequest?: () => void;
  onCompleteRequest?: () => void;
}

/**
 * Renders the main content area for the active workflow tab.
 *
 * @param isLoading - True while initial file data is being fetched
 * @param activeFile - File metadata and content for the selected tab
 * @param activeTabConfig - Tab definition used for the empty-state icon/message
 * @param showApprovalButton - Show the plan-approval CTA inside the content area
 * @param showCompleteButton - Show the task-complete CTA inside the content area
 * @param isRefetching - True while a manual refresh is running
 * @param onRefetch - Manual refresh trigger / 手動再読み込みトリガ
 * @param onPlanApprovalRequest - Opens the plan-approval modal / 計画承認モーダルを開く
 * @param onCompleteRequest - Triggers the task-completion flow / タスク完了フローを起動する
 */
export function WorkflowFileContent({
  isLoading,
  activeFile,
  activeTabConfig,
  showApprovalButton,
  showCompleteButton,
  isRefetching,
  onRefetch,
  onPlanApprovalRequest,
  onCompleteRequest,
}: WorkflowFileContentProps) {
  if (isLoading && !activeFile) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-5 w-5 text-zinc-400 animate-spin mr-2" />
        <span className="text-sm text-zinc-500 dark:text-zinc-400">読み込み中...</span>
      </div>
    );
  }

  if (!activeFile?.exists) {
    return (
      <div className="text-center py-10">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 mb-3">
          <activeTabConfig.icon className="h-6 w-6 text-zinc-400" />
        </div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{activeTabConfig.emptyText}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* File metadata row */}
      <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 pb-2 border-b border-zinc-100 dark:border-zinc-700/50">
        <span>
          更新:{' '}
          {activeFile.lastModified
            ? new Date(activeFile.lastModified).toLocaleString('ja-JP')
            : '不明'}
        </span>
        <div className="flex items-center gap-3">
          <span>{activeFile.size ? `${(activeFile.size / 1024).toFixed(1)}KB` : ''}</span>
          <button
            onClick={onRefetch}
            disabled={isRefetching}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            title="再読み込み"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Markdown body */}
      <div className="prose dark:prose-invert max-w-none prose-sm prose-headings:text-zinc-900 dark:prose-headings:text-zinc-100 prose-p:text-zinc-700 dark:prose-p:text-zinc-300">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            input: ({ type, checked, ...props }) => {
              if (type === 'checkbox') {
                return (
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled
                    className="mr-2 accent-indigo-600"
                    {...props}
                  />
                );
              }
              return <input type={type} {...props} />;
            },
            code: ({ className: codeClassName, children, ...props }) => (
              <code
                className={`${codeClassName || ''} bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded text-sm`}
                {...props}
              >
                {children}
              </code>
            ),
          }}
        >
          {activeFile.content || ''}
        </ReactMarkdown>
      </div>

      {/* Plan approval CTA (inside content area) */}
      {showApprovalButton && (
        <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center justify-between bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4 border border-amber-200 dark:border-amber-800">
            <div>
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                計画の承認が必要です
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                内容を確認して承認すると実装フェーズに移行します
              </p>
            </div>
            <button
              onClick={onPlanApprovalRequest}
              className="bg-amber-600 hover:bg-amber-700 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
            >
              承認して実装開始
            </button>
          </div>
        </div>
      )}

      {/* Verification complete CTA (inside content area) */}
      {showCompleteButton && (
        <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
            <div>
              <p className="text-sm font-medium text-green-900 dark:text-green-200">
                検証レポートの確認
              </p>
              <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">
                実装と検証が完了していればタスクを完了にします
              </p>
            </div>
            <button
              onClick={onCompleteRequest}
              className="bg-green-600 hover:bg-green-700 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
            >
              実装完了
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
