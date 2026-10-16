'use client';

/**
 * ConfirmDialog
 *
 * Reusable confirmation modal built on Modal.tsx. Replaces browser-native
 * confirm() calls with a design-consistent dialog that respects the app theme.
 */

import { useTranslations } from 'next-intl';

import { Modal } from '@/components/ui/modal/Modal';

export interface ConfirmOptions {
  /** Optional header title; omit to show message-only dialog. */
  title?: string;
  /** Body message (required). Supports \n line breaks via whitespace-pre-wrap. */
  message: string;
  /** Confirm button label (default: 'OK'). */
  confirmLabel?: string;
  /** Cancel button label (default: localized common.cancel). */
  cancelLabel?: string;
  /** 'destructive' renders the confirm button in red for delete operations. */
  variant?: 'default' | 'destructive';
}

interface ConfirmDialogProps {
  open: boolean;
  config: ConfirmOptions;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Renders a confirmation modal dialog.
 *
 * @param open - Whether the dialog is visible / 表示状態
 * @param config - Dialog configuration (title, message, labels, variant) / ダイアログ設定
 * @param onConfirm - Called when the confirm button is clicked / 確認ボタン押下時
 * @param onCancel - Called when the cancel button or backdrop/Esc is clicked / キャンセル押下時
 */
export function ConfirmDialog({ open, config, onConfirm, onCancel }: ConfirmDialogProps) {
  const ct = useTranslations('common');
  const {
    title,
    message,
    confirmLabel = 'OK',
    cancelLabel = ct('cancel'),
    variant = 'default',
  } = config;

  const confirmButtonClass =
    variant === 'destructive'
      ? 'rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 transition-colors'
      : 'rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 focus:outline-none focus:ring-2 focus:ring-zinc-500 transition-colors';

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      maxWidthClass="max-w-md"
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-500 transition-colors"
          >
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} className={confirmButtonClass}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">{message}</p>
    </Modal>
  );
}
