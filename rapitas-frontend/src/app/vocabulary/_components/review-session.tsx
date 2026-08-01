'use client';

/**
 * ReviewSession
 *
 * Full-screen flip-card review overlay: shows the front, click/Space flips to
 * the back, then the learner grades recall (again / good / easy). Grading and
 * queue rotation live in useVocabDeck; this component is presentation only.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { X, Check } from 'lucide-react';
import type { VocabCard, VocabGrade } from './vocab.types';

interface ReviewSessionProps {
  queue: VocabCard[];
  reviewedCount: number;
  onGrade: (card: VocabCard, grade: VocabGrade) => void;
  onEnd: () => void;
}

/**
 * Render the review overlay for the current due queue.
 *
 * @param props - Queue and grading callbacks from useVocabDeck. / キューと採点コールバック。
 */
export function ReviewSession({ queue, reviewedCount, onGrade, onEnd }: ReviewSessionProps) {
  const t = useTranslations('vocabulary.review');
  const [isFlipped, setIsFlipped] = useState(false);
  const card = queue[0] ?? null;

  // New card on top of the queue → always start on the front side.
  useEffect(() => {
    setIsFlipped(false);
  }, [card?.id]);

  const grade = useCallback(
    (g: VocabGrade) => {
      if (card) onGrade(card, g);
    },
    [card, onGrade],
  );

  // Keyboard: Space/Enter flips; 1/2/3 grade; Esc ends.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onEnd();
      if (!card) return;
      if (!isFlipped && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        setIsFlipped(true);
      } else if (isFlipped) {
        if (e.key === '1') grade('again');
        else if (e.key === '2' || e.key === ' ' || e.key === 'Enter') grade('good');
        else if (e.key === '3') grade('easy');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, isFlipped, grade, onEnd]);

  return (
    <div className="fixed inset-x-0 top-16 bottom-0 z-[80] flex flex-col bg-white dark:bg-indigo-dark-900">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          {t('progress', { done: reviewedCount, remaining: queue.length })}
        </span>
        <button
          onClick={onEnd}
          aria-label={t('end')}
          className="rounded-lg p-1.5 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {card ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
          <button
            onClick={() => setIsFlipped(true)}
            disabled={isFlipped}
            className="w-full max-w-xl rounded-lg border border-zinc-200 bg-zinc-50 p-10 text-center dark:border-zinc-700 dark:bg-zinc-900"
          >
            <div className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
              {card.front}
            </div>
            {isFlipped && (
              <>
                <div className="mt-6 whitespace-pre-line border-t border-zinc-200 pt-6 text-xl text-zinc-800 dark:border-zinc-700 dark:text-zinc-200">
                  {card.back}
                </div>
                {card.note && (
                  <div className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{card.note}</div>
                )}
              </>
            )}
            {!isFlipped && (
              <div className="mt-6 text-xs text-zinc-400 dark:text-zinc-500">{t('flipHint')}</div>
            )}
          </button>

          {isFlipped && (
            <div className="flex gap-3">
              <button
                onClick={() => grade('again')}
                className="rounded-lg border border-red-200 bg-red-50 px-5 py-2.5 text-sm font-medium text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-950/50"
              >
                {t('again')}
                <span className="ml-1.5 text-xs opacity-60">1</span>
              </button>
              <button
                onClick={() => grade('good')}
                className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-500"
              >
                {t('good')}
                <span className="ml-1.5 text-xs opacity-60">2</span>
              </button>
              <button
                onClick={() => grade('easy')}
                className="rounded-lg border border-green-200 bg-green-50 px-5 py-2.5 text-sm font-medium text-green-700 hover:bg-green-100 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400 dark:hover:bg-green-950/50"
              >
                {t('easy')}
                <span className="ml-1.5 text-xs opacity-60">3</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <Check className="h-10 w-10 text-green-500" />
          <p className="text-lg font-medium text-zinc-900 dark:text-zinc-100">{t('doneTitle')}</p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {t('doneBody', { count: reviewedCount })}
          </p>
          <button
            onClick={onEnd}
            className="mt-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            {t('backToDeck')}
          </button>
        </div>
      )}
    </div>
  );
}
