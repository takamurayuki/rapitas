'use client';
// AddCardModal

import { useTranslations } from 'next-intl';

interface AddCardModalProps {
  cardFront: string;
  cardBack: string;
  onCardFrontChange: (v: string) => void;
  onCardBackChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

/**
 * Modal for adding a new flashcard to the current deck.
 *
 * @param props - See AddCardModalProps
 */
export function AddCardModal({
  cardFront,
  cardBack,
  onCardFrontChange,
  onCardBackChange,
  onSubmit,
  onClose,
}: AddCardModalProps) {
  const t = useTranslations('flashcards');
  const tc = useTranslations('common');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-zinc-800 rounded-xl w-full max-w-md p-6">
        <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-4">
          {t('addCardTitle')}
        </h2>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              {t('questionFront')}
            </label>
            <textarea
              value={cardFront}
              onChange={(e) => onCardFrontChange(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              {t('answerBack')}
            </label>
            <textarea
              value={cardBack}
              onChange={(e) => onCardBackChange(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
              required
            />
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded-lg"
            >
              {tc('cancel')}
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg"
            >
              {tc('add')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
