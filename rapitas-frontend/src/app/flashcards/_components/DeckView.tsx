'use client';
// DeckView

import { useTranslations } from 'next-intl';
import {
  Plus,
  Trash2,
  ChevronLeft,
  Brain,
  Layers,
  Sparkles,
} from 'lucide-react';
import type { FlashcardDeck } from '@/types';
import { AddCardModal } from './AddCardModal';
import { GenerateCardsModal } from './GenerateCardsModal';

interface DeckViewProps {
  deck: FlashcardDeck;
  isCardModalOpen: boolean;
  isGenerateModalOpen: boolean;
  cardFront: string;
  cardBack: string;
  generateTopic: string;
  generateCount: number;
  generateDifficulty: 'beginner' | 'intermediate' | 'advanced';
  generateLanguage: 'ja' | 'en';
  isGenerating: boolean;
  onBack: () => void;
  onStartStudy: () => void;
  onDeleteCard: (cardId: number) => void;
  onOpenCardModal: () => void;
  onCloseCardModal: () => void;
  onOpenGenerateModal: () => void;
  onCloseGenerateModal: () => void;
  onCardFrontChange: (v: string) => void;
  onCardBackChange: (v: string) => void;
  onGenerateTopicChange: (v: string) => void;
  onGenerateCountChange: (n: number) => void;
  onGenerateDifficultyChange: (
    d: 'beginner' | 'intermediate' | 'advanced',
  ) => void;
  onGenerateLanguageChange: (lang: 'ja' | 'en') => void;
  onAddCard: (e: React.FormEvent) => void;
  onGenerateCards: (e: React.FormEvent) => void;
}

/**
 * Deck detail view listing all cards with study and management controls.
 *
 * @param props - See DeckViewProps
 */
export function DeckView({
  deck,
  isCardModalOpen,
  isGenerateModalOpen,
  cardFront,
  cardBack,
  generateTopic,
  generateCount,
  generateDifficulty,
  generateLanguage,
  isGenerating,
  onBack,
  onStartStudy,
  onDeleteCard,
  onOpenCardModal,
  onCloseCardModal,
  onOpenGenerateModal,
  onCloseGenerateModal,
  onCardFrontChange,
  onCardBackChange,
  onGenerateTopicChange,
  onGenerateCountChange,
  onGenerateDifficultyChange,
  onGenerateLanguageChange,
  onAddCard,
  onGenerateCards,
}: DeckViewProps) {
  const t = useTranslations('flashcards');

  const hasCards = (deck.cards?.length || 0) > 0;

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Deck header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{
              backgroundColor: `${deck.color}20`,
              color: deck.color,
            }}
          >
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
              {deck.name}
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {deck.cards?.length || 0} {t('cardsCount')}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onOpenGenerateModal}
            className="flex items-center gap-2 px-3 py-2 border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700"
          >
            <Sparkles className="w-4 h-4" />
            {t('aiGenerate')}
          </button>
          <button
            onClick={onOpenCardModal}
            className="flex items-center gap-2 px-3 py-2 border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700"
          >
            <Plus className="w-4 h-4" />
            {t('addCard')}
          </button>
          {hasCards && (
            <button
              onClick={onStartStudy}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Brain className="w-4 h-4" />
              {t('startLearning')}
            </button>
          )}
        </div>
      </div>

      {/* Card list */}
      <div className="space-y-3">
        {deck.cards?.map((card, index) => (
          <div
            key={card.id}
            className="flex items-center gap-4 p-4 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700"
          >
            <span className="w-8 h-8 bg-zinc-100 dark:bg-zinc-700 rounded-full flex items-center justify-center text-sm font-medium text-zinc-600 dark:text-zinc-400">
              {index + 1}
            </span>
            <div className="flex-1 grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-1">
                  {t('question')}
                </p>
                <p className="text-zinc-900 dark:text-zinc-100">{card.front}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-1">
                  {t('answer')}
                </p>
                <p className="text-zinc-900 dark:text-zinc-100">{card.back}</p>
              </div>
            </div>
            <button
              onClick={() => onDeleteCard(card.id)}
              className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {/* Empty state */}
      {!hasCards && (
        <div className="text-center py-12">
          <Layers className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-4" />
          <p className="text-zinc-500 dark:text-zinc-400 mb-4">
            {t('noCards')}
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={onOpenGenerateModal}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Sparkles className="w-4 h-4" />
              {t('generateWithAi')}
            </button>
            <button
              onClick={onOpenCardModal}
              className="px-4 py-2 border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700"
            >
              {t('addManually')}
            </button>
          </div>
        </div>
      )}

      {/* Modals */}
      {isCardModalOpen && (
        <AddCardModal
          cardFront={cardFront}
          cardBack={cardBack}
          onCardFrontChange={onCardFrontChange}
          onCardBackChange={onCardBackChange}
          onSubmit={onAddCard}
          onClose={onCloseCardModal}
        />
      )}

      {isGenerateModalOpen && (
        <GenerateCardsModal
          topic={generateTopic}
          count={generateCount}
          difficulty={generateDifficulty}
          language={generateLanguage}
          isGenerating={isGenerating}
          onTopicChange={onGenerateTopicChange}
          onCountChange={onGenerateCountChange}
          onDifficultyChange={onGenerateDifficultyChange}
          onLanguageChange={onGenerateLanguageChange}
          onSubmit={onGenerateCards}
          onClose={onCloseGenerateModal}
        />
      )}
    </div>
  );
}
