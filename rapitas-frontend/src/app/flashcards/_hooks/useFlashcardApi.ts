'use client';
// useFlashcardApi

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import type { FlashcardDeck } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import type { SchedulePreview } from './useFlashcards';

const logger = createLogger('useFlashcardApi');

interface UseFlashcardApiSetters {
  setDecks: (decks: FlashcardDeck[]) => void;
  setLoading: (v: boolean) => void;
  setSelectedDeck: (deck: FlashcardDeck | null) => void;
  setIsCreateModalOpen: (v: boolean) => void;
  setIsCardModalOpen: (v: boolean) => void;
  setIsGenerateModalOpen: (v: boolean) => void;
  setDeckName: (v: string) => void;
  setCardFront: (v: string) => void;
  setCardBack: (v: string) => void;
  setGenerateTopic: (v: string) => void;
  setGenerateCount: (n: number) => void;
  setGenerateDifficulty: (d: 'beginner' | 'intermediate' | 'advanced') => void;
  setIsGenerating: (v: boolean) => void;
  setSchedulePreview: (p: SchedulePreview | null) => void;
  setIsStudyMode: (v: boolean) => void;
  setCurrentCardIndex: (i: number) => void;
}

interface UseFlashcardApiState {
  selectedDeck: FlashcardDeck | null;
  currentCardIndex: number;
  deckName: string;
  deckColor: string;
  cardFront: string;
  cardBack: string;
  generateTopic: string;
  generateCount: number;
  generateDifficulty: 'beginner' | 'intermediate' | 'advanced';
  generateLanguage: 'ja' | 'en';
}

export interface UseFlashcardApiReturn {
  fetchDecks: () => Promise<void>;
  fetchDeck: (id: number) => Promise<void>;
  handleCreateDeck: (e: React.FormEvent) => Promise<void>;
  handleDeleteDeck: (id: number) => Promise<void>;
  handleAddCard: (e: React.FormEvent) => Promise<void>;
  handleDeleteCard: (cardId: number) => Promise<void>;
  handleReview: (quality: number) => Promise<void>;
  fetchSchedulePreview: (cardId: number) => Promise<void>;
  handleGenerateCards: (e: React.FormEvent) => Promise<void>;
}

/**
 * Builds all API-level flashcard operations, reading state values and writing via setters.
 *
 * @param state - Current values consumed by API functions
 * @param setters - Setter callbacks that update the parent hook's state
 * @returns UseFlashcardApiReturn
 */
export function useFlashcardApi(
  state: UseFlashcardApiState,
  setters: UseFlashcardApiSetters,
): UseFlashcardApiReturn {
  const t = useTranslations('flashcards');

  const {
    selectedDeck,
    currentCardIndex,
    deckName,
    deckColor,
    cardFront,
    cardBack,
    generateTopic,
    generateCount,
    generateDifficulty,
    generateLanguage,
  } = state;

  const {
    setDecks,
    setLoading,
    setSelectedDeck,
    setIsCreateModalOpen,
    setIsCardModalOpen,
    setIsGenerateModalOpen,
    setDeckName,
    setCardFront,
    setCardBack,
    setGenerateTopic,
    setGenerateCount,
    setGenerateDifficulty,
    setIsGenerating,
    setSchedulePreview,
    setIsStudyMode,
    setCurrentCardIndex,
  } = setters;

  /** Fetch all decks and update the deck list. */
  const fetchDecks = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/flashcard-decks`);
      if (res.ok) setDecks(await res.json());
    } catch (e) {
      logger.error('Failed to fetch decks:', e);
    } finally {
      setLoading(false);
    }
  }, [setDecks, setLoading]);

  /** Fetch a single deck with its full card list. */
  const fetchDeck = useCallback(
    async (id: number) => {
      try {
        const res = await fetch(`${API_BASE_URL}/flashcard-decks/${id}`);
        if (res.ok) {
          setSelectedDeck(await res.json());
        }
      } catch (e) {
        logger.error('Failed to fetch deck:', e);
      }
    },
    [setSelectedDeck],
  );

  /** Create a new deck using the current deckName value. */
  const handleCreateDeck = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!deckName.trim()) return;
      try {
        const res = await fetch(`${API_BASE_URL}/flashcard-decks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: deckName, color: deckColor }),
        });
        if (res.ok) {
          // Refresh deck list after creation
          const listRes = await fetch(`${API_BASE_URL}/flashcard-decks`);
          if (listRes.ok) setDecks(await listRes.json());
          setIsCreateModalOpen(false);
          setDeckName('');
        }
      } catch (e) {
        logger.error('Failed to create deck:', e);
      }
    },
    [deckName, deckColor, setDecks, setIsCreateModalOpen, setDeckName],
  );

  /** Delete a deck by ID after browser confirmation. */
  const handleDeleteDeck = useCallback(
    async (id: number) => {
      if (!confirm(t('confirmDelete'))) return;
      try {
        const res = await fetch(`${API_BASE_URL}/flashcard-decks/${id}`, {
          method: 'DELETE',
        });
        if (res.ok) {
          const listRes = await fetch(`${API_BASE_URL}/flashcard-decks`);
          if (listRes.ok) setDecks(await listRes.json());
          if (selectedDeck?.id === id) {
            setSelectedDeck(null);
          }
        }
      } catch (e) {
        logger.error('Failed to delete deck:', e);
      }
    },
    [t, selectedDeck, setDecks, setSelectedDeck],
  );

  /** Add a new card to the currently selected deck. */
  const handleAddCard = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!cardFront.trim() || !cardBack.trim() || !selectedDeck) return;
      try {
        const res = await fetch(`${API_BASE_URL}/flashcard-decks/${selectedDeck.id}/cards`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ front: cardFront, back: cardBack }),
        });
        if (res.ok) {
          await fetchDeck(selectedDeck.id);
          setIsCardModalOpen(false);
          setCardFront('');
          setCardBack('');
        }
      } catch (e) {
        logger.error('Failed to add card:', e);
      }
    },
    [cardFront, cardBack, selectedDeck, fetchDeck, setIsCardModalOpen, setCardFront, setCardBack],
  );

  /** Delete a card by ID after browser confirmation. */
  const handleDeleteCard = useCallback(
    async (cardId: number) => {
      if (!confirm(t('confirmDeleteCard'))) return;
      try {
        const res = await fetch(`${API_BASE_URL}/flashcards/${cardId}`, {
          method: 'DELETE',
        });
        if (res.ok && selectedDeck) {
          await fetchDeck(selectedDeck.id);
        }
      } catch (e) {
        logger.error('Failed to delete card:', e);
      }
    },
    [t, selectedDeck, fetchDeck],
  );

  /** Record a spaced-repetition review (SM-2, quality 1–5) and advance the session. */
  const handleReview = useCallback(
    async (quality: number) => {
      if (!selectedDeck?.cards?.[currentCardIndex]) return;
      const card = selectedDeck.cards[currentCardIndex];
      try {
        await fetch(`${API_BASE_URL}/flashcards/${card.id}/review`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quality }),
        });
        setSchedulePreview(null);
        if (currentCardIndex < (selectedDeck.cards?.length || 0) - 1) {
          setCurrentCardIndex(currentCardIndex + 1);
        } else {
          // Review session complete
          setIsStudyMode(false);
          setCurrentCardIndex(0);
          await fetchDeck(selectedDeck.id);
        }
      } catch (e) {
        logger.error('Failed to review card:', e);
      }
    },
    [
      selectedDeck,
      currentCardIndex,
      fetchDeck,
      setSchedulePreview,
      setCurrentCardIndex,
      setIsStudyMode,
    ],
  );

  /** Fetch the spaced-repetition schedule preview for a card. */
  const fetchSchedulePreview = useCallback(
    async (cardId: number) => {
      try {
        const res = await fetch(`${API_BASE_URL}/flashcards/${cardId}/schedule-preview`);
        if (res.ok) {
          setSchedulePreview(await res.json());
        }
      } catch (e) {
        logger.error('Failed to fetch schedule preview:', e);
        setSchedulePreview(null);
      }
    },
    [setSchedulePreview],
  );

  /** Generate flashcards via AI for the currently selected deck. */
  const handleGenerateCards = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!generateTopic.trim() || !selectedDeck) return;
      setIsGenerating(true);
      try {
        const res = await fetch(`${API_BASE_URL}/flashcard-decks/${selectedDeck.id}/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic: generateTopic,
            count: generateCount,
            difficulty: generateDifficulty,
            language: generateLanguage,
          }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          await fetchDeck(selectedDeck.id);
          setIsGenerateModalOpen(false);
          setGenerateTopic('');
          setGenerateCount(10);
          setGenerateDifficulty('intermediate');
        } else {
          if (data.error === 'API key not configured') {
            alert(t('apiKeyNotSet'));
          } else {
            alert(data.error || t('generationFailed'));
          }
        }
      } catch (e) {
        logger.error('Failed to generate cards:', e);
        alert(t('generationFailed'));
      } finally {
        setIsGenerating(false);
      }
    },
    [
      generateTopic,
      generateCount,
      generateDifficulty,
      generateLanguage,
      selectedDeck,
      fetchDeck,
      setIsGenerateModalOpen,
      setGenerateTopic,
      setGenerateCount,
      setGenerateDifficulty,
      setIsGenerating,
      t,
    ],
  );

  return {
    fetchDecks,
    fetchDeck,
    handleCreateDeck,
    handleDeleteDeck,
    handleAddCard,
    handleDeleteCard,
    handleReview,
    fetchSchedulePreview,
    handleGenerateCards,
  };
}
