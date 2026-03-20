/**
 * StudyView
 *
 * Renders the full-screen card-flip study interface for a flashcard deck.
 * Card progression, review quality input, and schedule preview display are
 * all controlled by props — this component owns no state of its own.
 */
'use client';

import { useTranslations } from 'next-intl';
import { ChevronLeft, RotateCcw, Brain, Check, X } from 'lucide-react';
import type { FlashcardDeck } from '@/types';
import type { SchedulePreview } from './useFlashcards';

interface StudyViewProps {
  deck: FlashcardDeck;
  currentCardIndex: number;
  isFlipped: boolean;
  schedulePreview: SchedulePreview | null;
  onFlip: () => void;
  onUnflip: () => void;
  onReview: (quality: number) => void;
  onExit: () => void;
  formatInterval: (dateStr: string) => string;
}

/**
 * Full-screen study mode view for a flashcard deck.
 *
 * @param props - See StudyViewProps
 * @returns null when the current card index is out of bounds
 */
export function StudyView({
  deck,
  currentCardIndex,
  isFlipped,
  schedulePreview,
  onFlip,
  onUnflip,
  onReview,
  onExit,
  formatInterval,
}: StudyViewProps) {
  const t = useTranslations('flashcards');
  const tc = useTranslations('common');

  const card = deck.cards?.[currentCardIndex];
  if (!card) return null;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={onExit}
          className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <ChevronLeft className="w-5 h-5" />
          {tc('back')}
        </button>
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          {currentCardIndex + 1} / {deck.cards?.length}
        </span>
      </div>

      {/* Card flip area */}
      <div
        onClick={() => {
          if (!isFlipped) {
            onFlip();
          } else {
            onUnflip();
          }
        }}
        className="aspect-3/2 bg-white dark:bg-zinc-800 rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-700 flex items-center justify-center p-8 cursor-pointer transition-all hover:shadow-2xl"
      >
        <div className="text-center">
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-4">
            {isFlipped ? t('answer') : t('question')}
          </p>
          <p className="text-2xl font-medium text-zinc-900 dark:text-zinc-50">
            {isFlipped ? card.back : card.front}
          </p>
          {!isFlipped && (
            <p className="mt-6 text-sm text-zinc-400 dark:text-zinc-500">
              {t('tapToSeeAnswer')}
            </p>
          )}
        </div>
      </div>

      {/* Review quality buttons — only shown after flip */}
      {isFlipped && (
        <div className="mt-6 grid grid-cols-4 gap-3">
          <button
            onClick={() => onReview(1)}
            className="p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-xl hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
          >
            <X className="w-5 h-5 mx-auto mb-1" />
            <span className="text-xs block">{t('forgot')}</span>
            {schedulePreview?.again && (
              <span className="text-[10px] opacity-70 block">
                {formatInterval(schedulePreview.again.due)}
              </span>
            )}
          </button>
          <button
            onClick={() => onReview(3)}
            className="p-3 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-xl hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
          >
            <RotateCcw className="w-5 h-5 mx-auto mb-1" />
            <span className="text-xs block">{t('difficult')}</span>
            {schedulePreview?.hard && (
              <span className="text-[10px] opacity-70 block">
                {formatInterval(schedulePreview.hard.due)}
              </span>
            )}
          </button>
          <button
            onClick={() => onReview(4)}
            className="p-3 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-xl hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
          >
            <Check className="w-5 h-5 mx-auto mb-1" />
            <span className="text-xs block">{t('remembered')}</span>
            {schedulePreview?.good && (
              <span className="text-[10px] opacity-70 block">
                {formatInterval(schedulePreview.good.due)}
              </span>
            )}
          </button>
          <button
            onClick={() => onReview(5)}
            className="p-3 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 rounded-xl hover:bg-emerald-200 dark:hover:bg-emerald-900/50 transition-colors"
          >
            <Brain className="w-5 h-5 mx-auto mb-1" />
            <span className="text-xs block">{t('perfect')}</span>
            {schedulePreview?.easy && (
              <span className="text-[10px] opacity-70 block">
                {formatInterval(schedulePreview.easy.due)}
              </span>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
