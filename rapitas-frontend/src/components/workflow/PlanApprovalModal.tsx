'use client';

import { useState } from 'react';
import type { WorkflowFile } from '@/types';
import { useWorkflowApproval } from '@/hooks/useWorkflowApproval';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { X, CheckCircle, AlertTriangle, FileText, Loader2 } from 'lucide-react';

export interface PlanApprovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskId: number;
  planFile: WorkflowFile;
  onApprovalComplete?: (approved: boolean, newStatus?: string) => void;
}

export default function PlanApprovalModal({
  isOpen,
  onClose,
  taskId,
  planFile,
  onApprovalComplete,
}: PlanApprovalModalProps) {
  const [showRejectReason, setShowRejectReason] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const { isApproving, error, approvePlan, clearError } = useWorkflowApproval(
    taskId,
    (newStatus) => {
      if (onApprovalComplete) {
        onApprovalComplete(newStatus === 'plan_approved', newStatus);
      }
      onClose();
    },
  );

  if (!isOpen) return null;

  const handleApprove = async () => {
    clearError();
    await approvePlan(true);
  };

  const handleReject = async () => {
    if (!showRejectReason) {
      setShowRejectReason(true);
      return;
    }
    if (!rejectReason.trim()) {
      return;
    }
    clearError();
    const result = await approvePlan(false, rejectReason);
    if (result.success) {
      setShowRejectReason(false);
      setRejectReason('');
    }
  };

  const handleClose = () => {
    setShowRejectReason(false);
    setRejectReason('');
    clearError();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/50 transition-opacity"
        onClick={handleClose}
      />

      {/* Modal content */}
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="relative bg-white dark:bg-zinc-800 rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-zinc-200 dark:border-zinc-700">
            <div className="flex items-center space-x-2">
              <FileText className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
                実装計画の承認
              </h2>
            </div>
            <button
              onClick={handleClose}
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          {/* Error display */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 p-4 m-6 mb-0">
              <div className="flex">
                <AlertTriangle className="h-5 w-5 text-red-400 mr-3" />
                <p className="text-sm text-red-700 dark:text-red-300">
                  {error}
                </p>
              </div>
            </div>
          )}

          {/* File info */}
          <div className="px-6 py-3 bg-zinc-50 dark:bg-zinc-700/50 border-b border-zinc-200 dark:border-zinc-700">
            <div className="flex items-center justify-between text-sm text-zinc-600 dark:text-zinc-400">
              <div>
                最終更新:{' '}
                {planFile.lastModified
                  ? new Date(planFile.lastModified).toLocaleString('ja-JP')
                  : '不明'}
              </div>
              <div>
                サイズ:{' '}
                {planFile.size
                  ? `${Math.round(planFile.size / 1024)}KB`
                  : '不明'}
              </div>
            </div>
          </div>

          {/* Content area */}
          <div className="p-6 overflow-y-auto max-h-[60vh]">
            {planFile.exists && planFile.content ? (
              <div className="prose dark:prose-invert max-w-none">
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
                            className="mr-2"
                            {...props}
                          />
                        );
                      }
                      return <input type={type} {...props} />;
                    },
                    code: ({
                      className: codeClassName,
                      children,
                      ...props
                    }) => (
                      <code
                        className={`${codeClassName || ''} bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded text-sm`}
                        {...props}
                      >
                        {children}
                      </code>
                    ),
                  }}
                >
                  {planFile.content}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="text-center text-zinc-500 dark:text-zinc-400 py-8">
                <FileText className="mx-auto h-12 w-12 mb-3 opacity-50" />
                <p>計画ファイルの内容を読み込めませんでした</p>
              </div>
            )}
          </div>

          {/* Rejection reason input */}
          {showRejectReason && (
            <div className="px-6 py-4 bg-orange-50 dark:bg-orange-900/20 border-t border-orange-200 dark:border-orange-800">
              <label
                htmlFor="reject-reason"
                className="block text-sm font-medium text-orange-700 dark:text-orange-300 mb-2"
              >
                却下理由を入力してください
              </label>
              <textarea
                id="reject-reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="具体的な修正点や改善提案を入力してください..."
                className="w-full p-3 border border-orange-300 dark:border-orange-600 rounded-lg resize-none bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white placeholder-zinc-500 dark:placeholder-zinc-400"
                rows={3}
                disabled={isApproving}
              />
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between p-6 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-700/50">
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              この計画内容を確認して、実装を開始するか判断してください
            </div>
            <div className="flex space-x-3">
              <button
                onClick={handleClose}
                disabled={isApproving}
                className="px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 disabled:opacity-50 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={handleReject}
                disabled={isApproving}
                className="flex items-center px-4 py-2 text-sm font-medium text-orange-700 dark:text-orange-300 bg-orange-100 dark:bg-orange-900/30 border border-orange-300 dark:border-orange-600 rounded-lg hover:bg-orange-200 dark:hover:bg-orange-900/50 disabled:opacity-50 transition-colors"
              >
                {isApproving ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <AlertTriangle className="h-4 w-4 mr-2" />
                )}
                {showRejectReason ? '却下実行' : '却下'}
              </button>
              {!showRejectReason && (
                <button
                  onClick={handleApprove}
                  disabled={isApproving}
                  className="flex items-center px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg transition-colors"
                >
                  {isApproving ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <CheckCircle className="h-4 w-4 mr-2" />
                  )}
                  承認・実装開始
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
