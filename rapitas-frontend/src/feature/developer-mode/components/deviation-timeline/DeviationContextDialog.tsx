'use client';

/**
 * DeviationContextDialog
 *
 * Shows the execution-log lines before and after a deviation (task #1218
 * AC3), with the deviation's own line highlighted. Lines arrive already
 * masked from the backend.
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/modal/Modal';
import type { DeviationContextLine } from './deviation-timeline.types';

export interface DeviationContextDialogProps {
  open: boolean;
  executionId: number | null;
  seq: number | null;
  fetchContext: (executionId: number, seq: number) => Promise<DeviationContextLine[]>;
  onClose: () => void;
}

/**
 * @param open - Whether the dialog is visible / 表示状態
 * @param executionId - Execution the log belongs to / 実行ID
 * @param seq - Log sequence number of the deviation / 逸脱のログ連番
 * @param fetchContext - Loader for the surrounding lines / 前後ログの取得関数
 * @param onClose - Close request / 閉じる要求
 */
export function DeviationContextDialog({
  open,
  executionId,
  seq,
  fetchContext,
  onClose,
}: DeviationContextDialogProps) {
  const t = useTranslations('deviationTimeline');
  const [lines, setLines] = useState<DeviationContextLine[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open || executionId === null || seq === null) return;
    let cancelled = false;
    setLines(null);
    setFailed(false);
    fetchContext(executionId, seq)
      .then((result) => {
        if (!cancelled) setLines(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, executionId, seq, fetchContext]);

  return (
    <Modal open={open} onClose={onClose} title={t('contextTitle')} maxWidthClass="max-w-3xl">
      {failed ? (
        <p className="text-sm text-red-600 dark:text-red-400">{t('contextError')}</p>
      ) : lines === null ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('contextLoading')}</p>
      ) : lines.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('contextEmpty')}</p>
      ) : (
        <div className="max-h-[60vh] overflow-auto rounded-md bg-zinc-950 p-2 font-mono text-xs text-zinc-200">
          {lines.map((line) => (
            <div
              key={line.sequenceNumber}
              data-target={line.isTarget ? 'true' : 'false'}
              className={`flex gap-2 whitespace-pre-wrap break-all px-1 ${
                line.isTarget ? 'rounded bg-red-900/60 text-red-100' : ''
              }`}
            >
              <span className="shrink-0 select-none tabular-nums text-zinc-500">
                {line.sequenceNumber}
              </span>
              <span>{line.text}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
