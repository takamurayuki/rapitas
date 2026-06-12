'use client';

/**
 * Modal
 *
 * Lightweight, reusable centered modal: dimmed backdrop, Esc / backdrop-click to
 * close, optional title bar and footer. Used so "add" flows (idea box, concern
 * backlog) overlay the current page instead of navigating away — the user stays
 * put and can keep adding.
 */

import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** Optional leading icon shown next to the title. */
  icon?: ReactNode;
  children: ReactNode;
  /** Optional footer (e.g. action buttons), pinned below the body. */
  footer?: ReactNode;
  /** Tailwind max-width class for the panel. */
  maxWidthClass?: string;
}

/**
 * Renders a modal dialog when `open`.
 *
 * @param open - Whether the modal is visible / 表示状態
 * @param onClose - Called on backdrop click / Esc / close button / 閉じる要求
 * @param title - Header title / ヘッダータイトル
 * @param icon - Leading icon / 先頭アイコン
 * @param children - Body content / 本文
 * @param footer - Footer content / フッター
 * @param maxWidthClass - Panel max-width class / パネル最大幅クラス
 */
export function Modal({
  open,
  onClose,
  title,
  icon,
  children,
  footer,
  maxWidthClass = 'max-w-lg',
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center overflow-y-auto bg-black/50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`w-full ${maxWidthClass} rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900`}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || icon) && (
          <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {icon}
              {title}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="閉じる"
              className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="px-4 py-3">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
