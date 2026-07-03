'use client';
import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle } from 'lucide-react';
import { useFocusTrap } from '@/components/ui/modal/use-focus-trap';

interface DeleteNoteModalProps {
  isOpen: boolean;
  noteTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DeleteNoteModal({
  isOpen,
  noteTitle,
  onConfirm,
  onCancel,
}: DeleteNoteModalProps) {
  const t = useTranslations('notes');
  const tc = useTranslations('common');
  const tTask = useTranslations('task');
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onCancel]);

  useFocusTrap(panelRef, isOpen);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />

      {/* Modal content */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-note-modal-title"
        tabIndex={-1}
        className="relative bg-white dark:bg-zinc-900 rounded-xl shadow-2xl max-w-md w-full mx-4 p-6"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-12 h-12 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center">
            <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-500" />
          </div>
          <div>
            <h3
              id="delete-note-modal-title"
              className="text-lg font-semibold text-zinc-900 dark:text-zinc-100"
            >
              {t('deleteModal.title')}
            </h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('deleteModal.subtitle')}</p>
          </div>
        </div>

        <div className="mb-6">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            {t.rich('deleteModal.confirmQuestion', {
              noteTitle,
              b: (chunks) => <span className="font-medium">{chunks}</span>,
            })}
          </p>
        </div>

        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          >
            {tc('cancel')}
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
          >
            {tTask('confirmDelete')}
          </button>
        </div>
      </div>
    </div>
  );
}
