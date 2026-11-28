'use client';

/**
 * WorkflowStatusChange
 *
 * Lets a person move a task's workflow status by hand, behind a confirm dialog
 * that requires a reason. Not responsible for forcing a change past missing
 * artifacts — that stays an API-only operator action.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Replace } from 'lucide-react';
import { Modal } from '@/components/ui/modal/Modal';
import { API_BASE_URL } from '@/utils/api';
import type { WorkflowStatus } from '@/types';

/** Statuses that are meaningful to set by hand. */
const SELECTABLE_STATUSES = [
  'draft',
  'research_done',
  'plan_created',
  'plan_approved',
  'in_progress',
  'verify_done',
] as const satisfies readonly WorkflowStatus[];

const MAX_REASON_CHARS = 2000;

const FIELD_CLASS =
  'mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 focus:border-indigo-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100';

type Failure = { message: 'failed' | 'syncFailed' | 'missingFiles'; files?: string[] };

interface WorkflowStatusChangeProps {
  /** Task whose status is changed. / 対象タスクID */
  taskId: number;
  /** Status shown as the current one; null reads as draft. / 現在の状態 */
  currentStatus: WorkflowStatus | null;
  /** Called once the new status is saved. / 保存後の通知 */
  onChanged: (status: WorkflowStatus) => void;
}

/**
 * Trigger button plus the confirm dialog.
 *
 * @param props - Task id, current status and callback. / タスクID・現在の状態・完了通知
 * @returns The trigger, and the dialog while open. / トリガーとダイアログ
 */
export function WorkflowStatusChange({
  taskId,
  currentStatus,
  onChanged,
}: WorkflowStatusChangeProps) {
  const t = useTranslations('workflow');
  const tc = useTranslations('common');
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<WorkflowStatus | ''>('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  // A late response must not write another task's status after a remount.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const canSave = status !== '' && reason.trim() !== '' && !submitting;

  const reset = () => {
    setIsOpen(false);
    setStatus('');
    setReason('');
    setFailure(null);
  };

  const close = () => {
    if (!submitting) reset();
  };

  const submit = async () => {
    if (status === '' || !canSave) return;
    setSubmitting(true);
    setFailure(null);
    try {
      const res = await fetch(`${API_BASE_URL}/workflow/tasks/${taskId}/status`, {
        method: 'PUT',
        // The backend refuses callers that do not name a human source.
        headers: { 'Content-Type': 'application/json', 'X-Rapitas-Source': 'ui' },
        body: JSON.stringify({ status, reason: reason.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!mounted.current) return;
      if (res.status === 422 && Array.isArray(data?.missingFiles)) {
        setFailure({ message: 'missingFiles', files: data.missingFiles });
        return;
      }
      if (!res.ok) {
        setFailure({ message: 'failed' });
        return;
      }
      onChanged(status);
      // The status is saved; saving the same change again retries the sync.
      if (data?.queueSync?.outcome === 'error') {
        setFailure({ message: 'syncFailed' });
        return;
      }
      reset();
    } catch {
      if (mounted.current) setFailure({ message: 'failed' });
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        <Replace className="h-3.5 w-3.5" />
        {t('statusChange.cta')}
      </button>

      <Modal
        open={isOpen}
        onClose={close}
        icon={<Replace className="h-4 w-4 text-indigo-500" />}
        title={t('statusChange.title')}
        footer={
          <>
            <button
              type="button"
              onClick={close}
              disabled={submitting}
              className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-700 disabled:opacity-50 dark:hover:text-zinc-300"
            >
              {tc('cancel')}
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!canSave}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? t('statusChange.submitting') : t('statusChange.submit')}
            </button>
          </>
        }
      >
        <div className="space-y-3 text-xs text-zinc-500 dark:text-zinc-400">
          <p>
            {t('statusChange.current')}:{' '}
            <span
              data-testid="status-change-current"
              className="font-medium text-zinc-900 dark:text-zinc-100"
            >
              {t(`statusChange.status.${currentStatus ?? 'draft'}`)}
            </span>
          </p>
          <label className="block">
            {t('statusChange.next')}
            <select
              aria-label={t('statusChange.next')}
              value={status}
              onChange={(e) => setStatus(e.target.value as WorkflowStatus | '')}
              className={FIELD_CLASS}
            >
              <option value="">{t('statusChange.selectPlaceholder')}</option>
              {SELECTABLE_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`statusChange.status.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            {t('statusChange.reason')}
            <textarea
              aria-label={t('statusChange.reason')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={MAX_REASON_CHARS}
              required
              className={FIELD_CLASS}
            />
          </label>
          <ul className="list-disc space-y-1 pl-4">
            <li>{t('statusChange.noteRunning')}</li>
            <li>{t('statusChange.noteVerifyDone')}</li>
          </ul>
          {failure && (
            <div role="alert" className="text-rose-600 dark:text-rose-400">
              <p>{t(`statusChange.${failure.message}`)}</p>
              {failure.files && (
                <ul className="mt-1 list-disc pl-4">
                  {failure.files.map((file) => (
                    <li key={file}>{file}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
