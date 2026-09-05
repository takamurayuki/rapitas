'use client';
// CreateTaskModal

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { useFocusTrap } from '@/components/ui/modal/use-focus-trap';
import { formatDate } from '@/utils/date';

type Props = {
  /** ISO date string (YYYY-MM-DD) for the task's due date. */
  selectedDate: string;
  /** Called when the form is submitted with a task title. */
  onSubmit: (title: string) => Promise<void>;
  /** Called when the modal should close without action. */
  onClose: () => void;
};

/**
 * Modal form for creating a task with a pre-filled due date.
 *
 * @param props - selectedDate, onSubmit, onClose
 */
export function CreateTaskModal({ selectedDate, onSubmit, onClose }: Props) {
  const t = useTranslations('calendar');
  const tc = useTranslations('common');
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useFocusTrap(panelRef, true);

  // NOTE: declared after useFocusTrap so this effect's focus() call wins over
  // the trap's initial-focus targeting (the close button precedes this input
  // in DOM order, so native autoFocus would otherwise lose to the trap).
  useEffect(() => {
    titleInputRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    try {
      await onSubmit(title.trim());
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-task-modal-title"
        tabIndex={-1}
        className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3
            id="create-task-modal-title"
            className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
          >
            {t('addTask')}
          </h3>
          <button
            onClick={onClose}
            aria-label={tc('close')}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
          {t('deadline')}: {formatDate(selectedDate)}
        </p>

        <form onSubmit={handleSubmit}>
          <input
            ref={titleInputRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('taskNamePlaceholder')}
            className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-lg text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:border-indigo-400"
          />
          <div className="flex gap-2 mt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors"
            >
              {tc('cancel')}
            </button>
            <button
              type="submit"
              disabled={!title.trim() || creating}
              className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creating ? t('creating') : tc('create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
