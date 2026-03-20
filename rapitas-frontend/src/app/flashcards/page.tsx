/**
 * FlashcardsPage
 *
 * Root page component for the flashcards feature. Delegates all state to
 * useFlashcards and conditionally renders StudyView, DeckView, or DeckListView
 * based on the current navigation state.
 */
'use client';

import { useFlashcards } from './_hooks/useFlashcards';
import { StudyView } from './_components/StudyView';
import { DeckView } from './_components/DeckView';
import { DeckListView } from './_components/DeckListView';

export default function FlashcardsPage() {
  const {
    decks,
    selectedDeck,
    loading,
    isCreateModalOpen,
    isCardModalOpen,
    isGenerateModalOpen,
    isStudyMode,
    currentCardIndex,
    isFlipped,
    deckName,
    cardFront,
    cardBack,
    generateTopic,
    generateCount,
    generateDifficulty,
    generateLanguage,
    isGenerating,
    schedulePreview,
    setSelectedDeck,
    setIsCreateModalOpen,
    setIsCardModalOpen,
    setIsGenerateModalOpen,
    setIsStudyMode,
    setCurrentCardIndex,
    setIsFlipped,
    setDeckName,
    setCardFront,
    setCardBack,
    setGenerateTopic,
    setGenerateCount,
    setGenerateDifficulty,
    setGenerateLanguage,
    setSchedulePreview,
    fetchDeck,
    handleCreateDeck,
    handleDeleteDeck,
    handleAddCard,
    handleDeleteCard,
    handleReview,
    fetchSchedulePreview,
    startStudy,
    handleGenerateCards,
    formatInterval,
  } = useFlashcards();

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-zinc-200 dark:bg-zinc-700 rounded w-48" />
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 bg-zinc-200 dark:bg-zinc-700 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Study mode takes priority over deck view
  if (isStudyMode && selectedDeck?.cards) {
    return (
      <StudyView
        deck={selectedDeck}
        currentCardIndex={currentCardIndex}
        isFlipped={isFlipped}
        schedulePreview={schedulePreview}
        onFlip={() => {
          setIsFlipped(true);
          const card = selectedDeck.cards?.[currentCardIndex];
          if (card) fetchSchedulePreview(card.id);
        }}
        onUnflip={() => {
          setIsFlipped(false);
          setSchedulePreview(null);
        }}
        onReview={handleReview}
        onExit={() => {
          setIsStudyMode(false);
          setCurrentCardIndex(0);
        }}
        formatInterval={formatInterval}
      />
    );
  }

  if (selectedDeck) {
    return (
      <DeckView
        deck={selectedDeck}
        isCardModalOpen={isCardModalOpen}
        isGenerateModalOpen={isGenerateModalOpen}
        cardFront={cardFront}
        cardBack={cardBack}
        generateTopic={generateTopic}
        generateCount={generateCount}
        generateDifficulty={generateDifficulty}
        generateLanguage={generateLanguage}
        isGenerating={isGenerating}
        onBack={() => setSelectedDeck(null)}
        onStartStudy={startStudy}
        onDeleteCard={handleDeleteCard}
        onOpenCardModal={() => setIsCardModalOpen(true)}
        onCloseCardModal={() => setIsCardModalOpen(false)}
        onOpenGenerateModal={() => setIsGenerateModalOpen(true)}
        onCloseGenerateModal={() => setIsGenerateModalOpen(false)}
        onCardFrontChange={setCardFront}
        onCardBackChange={setCardBack}
        onGenerateTopicChange={setGenerateTopic}
        onGenerateCountChange={setGenerateCount}
        onGenerateDifficultyChange={setGenerateDifficulty}
        onGenerateLanguageChange={setGenerateLanguage}
        onAddCard={handleAddCard}
        onGenerateCards={handleGenerateCards}
      />
    );
  }

  return (
    <DeckListView
      decks={decks}
      isCreateModalOpen={isCreateModalOpen}
      deckName={deckName}
      onDeckNameChange={setDeckName}
      onSelectDeck={fetchDeck}
      onDeleteDeck={handleDeleteDeck}
      onOpenCreateModal={() => setIsCreateModalOpen(true)}
      onCloseCreateModal={() => setIsCreateModalOpen(false)}
      onCreateDeck={handleCreateDeck}
    />
  );
}
