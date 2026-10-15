'use client';
// SuggestionDetailModal

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import TaskSuggestionDetail from '../TaskSuggestionDetail';
import type { TaskSuggestion } from './SuggestionCard';
import { useFocusTrap } from '@/components/ui/modal/use-focus-trap';

type SuggestionDetailModalProps = {
  suggestion: TaskSuggestion;
  onClose: () => void;
  onApply: () => void;
};

/**
 * Modal for viewing and applying a single AI task suggestion.
 *
 * @param props - See SuggestionDetailModalProps
 * @returns Fixed-position overlay with a scrollable detail card.
 */
export function SuggestionDetailModal({
  suggestion,
  onClose,
  onApply,
}: SuggestionDetailModalProps) {
  const t = useTranslations('task');
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useFocusTrap(panelRef, true);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="suggestion-detail-modal-title"
        tabIndex={-1}
        className="relative bg-white dark:bg-zinc-900 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-6 py-4 flex items-center justify-between">
          <h2
            id="suggestion-detail-modal-title"
            className="text-lg font-semibold text-zinc-900 dark:text-zinc-100"
          >
            {t('suggestionDetailModal.title')}
          </h2>
          <button
            onClick={onClose}
            aria-label={t('suggestionDetailModal.close')}
            className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6">
          <TaskSuggestionDetail suggestion={suggestion} onApply={onApply} />
        </div>
      </div>
    </div>
  );
}
