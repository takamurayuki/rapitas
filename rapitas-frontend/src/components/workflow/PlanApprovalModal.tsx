'use client';

import { useEffect, useRef, useState } from 'react';
import type { WorkflowFile } from '@/types';
import { useWorkflowApproval } from '@/hooks/workflow/useWorkflowApproval';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { X, CheckCircle, AlertTriangle, FileText, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useLocaleStore } from '@/stores/locale-store';
import { toDateLocale } from '@/lib/utils';
import { useFocusTrap } from '@/components/ui/modal/use-focus-trap';

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
  const t = useTranslations('workflow');
  const tc = useTranslations('common');
  const locale = useLocaleStore((s) => s.locale);
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

  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowRejectReason(false);
        setRejectReason('');
        clearError();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, clearError]);

  useFocusTrap(dialogRef, isOpen);

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
      <div className="fixed inset-0 bg-black/50 transition-opacity" onClick={handleClose} />

      {/* Modal content */}
      <div className="flex items-center justify-center min-h-screen p-4">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="plan-approval-modal-title"
          tabIndex={-1}
          className="relative bg-white dark:bg-zinc-800 rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-zinc-200 dark:border-zinc-700">
            <div className="flex items-center space-x-2">
              <FileText className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
              <h2
                id="plan-approval-modal-title"
                className="text-lg font-semibold text-zinc-900 dark:text-white"
              >
                {t('planApprovalModal.title')}
              </h2>
            </div>
            <button
              onClick={handleClose}
              aria-label={tc('close')}
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
                <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
              </div>
            </div>
          )}

          {/* File info */}
          <div className="px-6 py-3 bg-zinc-50 dark:bg-zinc-700/50 border-b border-zinc-200 dark:border-zinc-700">
            <div className="flex items-center justify-between text-sm text-zinc-600 dark:text-zinc-400">
              <div>
                {t('planApprovalModal.lastUpdated')}{' '}
                {planFile.lastModified
                  ? new Date(planFile.lastModified).toLocaleString(toDateLocale(locale))
                  : t('planApprovalModal.unknown')}
              </div>
              <div>
                {t('planApprovalModal.size')}{' '}
                {planFile.size
                  ? `${Math.round(planFile.size / 1024)}KB`
                  : t('planApprovalModal.unknown')}
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
                  {planFile.content}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="text-center text-zinc-500 dark:text-zinc-400 py-8">
                <FileText className="mx-auto h-12 w-12 mb-3 opacity-50" />
                <p>{t('planApprovalModal.loadFailed')}</p>
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
                {t('planApprovalModal.rejectReasonLabel')}
              </label>
              <textarea
                id="reject-reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder={t('planApprovalModal.rejectReasonPlaceholder')}
                className="w-full p-3 border border-orange-300 dark:border-orange-600 rounded-lg resize-none bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white placeholder-zinc-500 dark:placeholder-zinc-400"
                rows={3}
                disabled={isApproving}
              />
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between p-6 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-700/50">
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              {t('planApprovalModal.confirmPrompt')}
            </div>
            <div className="flex space-x-3">
              <button
                onClick={handleClose}
                disabled={isApproving}
                className="px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 disabled:opacity-50 transition-colors"
              >
                {tc('cancel')}
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
                {showRejectReason
                  ? t('planApprovalModal.rejectExecute')
                  : t('planApprovalModal.reject')}
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
                  {t('planApprovalModal.approve')}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
