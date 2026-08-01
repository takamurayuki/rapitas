'use client';

/**
 * VocabDeckDetailPage
 *
 * One deck: add/edit/delete cards and launch the spaced-repetition review
 * session for the cards that are due.
 */
import { use, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Play, Plus } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { useConfirmDialog } from '@/components/ui/dialog/ConfirmDialogProvider';
import { useVocabDeck } from '../_components/use-vocab-deck';
import { VocabCardRow } from '../_components/card-row';
import { ReviewSession } from '../_components/review-session';

export default function VocabDeckDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const deckId = parseInt(id);
  const t = useTranslations('vocabulary');
  const confirm = useConfirmDialog();
  const vm = useVocabDeck(deckId);

  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [note, setNote] = useState('');

  const handleAdd = async () => {
    if (await vm.addCard(front, back, note)) {
      setFront('');
      setBack('');
      setNote('');
    }
  };

  const handleDeleteCard = async (cardId: number) => {
    if (await confirm(t('deleteCardConfirm'))) await vm.deleteCard(cardId);
  };

  const inputCls =
    'rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100';

  if (vm.isLoading) {
    return (
      <div className="flex h-[calc(100vh-4.2rem)] items-center justify-center bg-background">
        <Spinner size="md" />
      </div>
    );
  }
  if (!vm.deck) {
    return (
      <div className="flex h-[calc(100vh-4.2rem)] flex-col items-center justify-center gap-3 bg-background text-sm text-zinc-500">
        {t('notFound')}
        <Link href="/vocabulary" className="text-indigo-600 dark:text-indigo-400 hover:underline">
          {t('backToList')}
        </Link>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4.2rem)] overflow-auto bg-background">
      <div className="mx-auto max-w-4xl px-3 sm:px-4 md:px-6 py-4">
        <Link
          href="/vocabulary"
          className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('backToList')}
        </Link>

        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
              {vm.deck.name}
            </h1>
            {vm.deck.description && (
              <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
                {vm.deck.description}
              </p>
            )}
          </div>
          <button
            onClick={vm.startReview}
            disabled={vm.deck.dueCount === 0}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            {vm.deck.dueCount > 0 ? t('startReview', { count: vm.deck.dueCount }) : t('noDueCards')}
          </button>
        </div>

        {/* Add card — narrow front (a word) beside a multiline back (a word
            often has several meanings — one per line, Shift+Enter). */}
        <div className="mb-4 flex flex-col gap-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900/40">
          <div className="flex items-stretch gap-2">
            <input
              value={front}
              onChange={(e) => setFront(e.target.value)}
              aria-label={t('frontPlaceholder')}
              placeholder={t('frontPlaceholder')}
              className={`${inputCls} w-2/5 self-start`}
            />
            <textarea
              value={back}
              onChange={(e) => setBack(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleAdd();
                }
              }}
              rows={2}
              aria-label={t('backPlaceholder')}
              placeholder={t('backPlaceholder')}
              className={`${inputCls} flex-1 resize-none`}
            />
          </div>
          <div className="flex gap-2">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              aria-label={t('notePlaceholder')}
              placeholder={t('notePlaceholder')}
              className={`${inputCls} flex-1`}
            />
            <button
              onClick={handleAdd}
              disabled={!front.trim() || !back.trim()}
              className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {t('addCard')}
            </button>
          </div>
        </div>

        {vm.deck.cards.length === 0 ? (
          <p className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
            {t('noCards')}
          </p>
        ) : (
          <div>
            {vm.deck.cards.map((card) => (
              <VocabCardRow
                key={card.id}
                card={card}
                onUpdate={vm.updateCard}
                onUpdateFields={vm.updateCardFields}
                onDelete={handleDeleteCard}
              />
            ))}
          </div>
        )}
      </div>

      {vm.reviewQueue && (
        <ReviewSession
          queue={vm.reviewQueue}
          reviewedCount={vm.reviewedCount}
          onGrade={vm.gradeCard}
          onEnd={vm.endReview}
        />
      )}
    </div>
  );
}
