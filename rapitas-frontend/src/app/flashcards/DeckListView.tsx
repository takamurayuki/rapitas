/**
 * DeckListView
 *
 * Renders the top-level flashcard deck grid, empty state, and the
 * create-deck modal. Deck selection and deletion are handled via callbacks.
 */
'use client';

import { useTranslations } from 'next-intl';
import { Plus, Trash2, Brain, Layers, Sparkles } from 'lucide-react';
import type { FlashcardDeck } from '@/types';

interface DeckListViewProps {
  decks: FlashcardDeck[];
  isCreateModalOpen: boolean;
  deckName: string;
  onDeckNameChange: (name: string) => void;
  onSelectDeck: (id: number) => void;
  onDeleteDeck: (id: number) => void;
  onOpenCreateModal: () => void;
  onCloseCreateModal: () => void;
  onCreateDeck: (e: React.FormEvent) => void;
}

/**
 * Grid view of all flashcard decks with create and delete controls.
 *
 * @param props - See DeckListViewProps
 */
export function DeckListView({
  decks,
  isCreateModalOpen,
  deckName,
  onDeckNameChange,
  onSelectDeck,
  onDeleteDeck,
  onOpenCreateModal,
  onCloseCreateModal,
  onCreateDeck,
}: DeckListViewProps) {
  const t = useTranslations('flashcards');
  const tc = useTranslations('common');

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Brain className="w-8 h-8 text-blue-500" />
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              {t('title')}
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {t('subtitle')}
            </p>
          </div>
        </div>
        <button
          onClick={onOpenCreateModal}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus className="w-5 h-5" />
          {t('newDeck')}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {decks.map((deck) => (
          <div
            key={deck.id}
            onClick={() => onSelectDeck(deck.id)}
            className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 cursor-pointer hover:shadow-lg transition-all"
          >
            <div className="flex items-start justify-between mb-3">
              <div
                className="w-12 h-12 rounded-lg flex items-center justify-center"
                style={{
                  backgroundColor: `${deck.color}20`,
                  color: deck.color,
                }}
              >
                <Layers className="w-6 h-6" />
              </div>
              <button
                onClick={(e) => {
                  // NOTE: stopPropagation prevents the deck click handler from firing.
                  e.stopPropagation();
                  onDeleteDeck(deck.id);
                }}
                className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-50 mb-1">
              {deck.name}
            </h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {deck._count?.cards || 0} {t('cardsUnit')}
            </p>
          </div>
        ))}
      </div>

      {decks.length === 0 && (
        <div className="text-center py-12">
          <Brain className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-4" />
          <p className="text-zinc-500 dark:text-zinc-400">{t('noDecks')}</p>
        </div>
      )}

      {/* Create Deck Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-4">
              {t('newDeckTitle')}
            </h2>
            <form onSubmit={onCreateDeck} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  {t('deckName')}
                </label>
                <input
                  type="text"
                  value={deckName}
                  onChange={(e) => onDeckNameChange(e.target.value)}
                  placeholder={t('deckExample')}
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700"
                  required
                />
              </div>
              <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg">
                <p className="text-sm text-blue-700 dark:text-blue-300 flex items-start gap-2">
                  <Sparkles className="w-4 h-4 mt-0.5 shrink-0" />
                  {t('deckInfo')}
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onCloseCreateModal}
                  className="flex-1 px-4 py-2 border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded-lg"
                >
                  {tc('cancel')}
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg"
                >
                  {tc('create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
