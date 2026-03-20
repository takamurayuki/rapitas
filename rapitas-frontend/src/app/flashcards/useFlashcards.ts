/**
 * useFlashcards
 *
 * Orchestration hook for the flashcards feature. Owns all UI state (modals,
 * study mode, flip state) and delegates API operations to useFlashcardApi.
 * Also exports SchedulePreview for use by sub-components.
 */
'use client';

import { useEffect, useState, useCallback } from 'react';
import type { FlashcardDeck } from '@/types';
import { useFlashcardApi } from './useFlashcardApi';

export interface SchedulePreview {
  [key: string]: { due: string; interval: number };
}

export interface UseFlashcardsReturn {
  // State
  decks: FlashcardDeck[];
  selectedDeck: FlashcardDeck | null;
  loading: boolean;
  isCreateModalOpen: boolean;
  isCardModalOpen: boolean;
  isGenerateModalOpen: boolean;
  isStudyMode: boolean;
  currentCardIndex: number;
  isFlipped: boolean;
  deckName: string;
  cardFront: string;
  cardBack: string;
  generateTopic: string;
  generateCount: number;
  generateDifficulty: 'beginner' | 'intermediate' | 'advanced';
  generateLanguage: 'ja' | 'en';
  isGenerating: boolean;
  schedulePreview: SchedulePreview | null;
  // Setters
  setSelectedDeck: (deck: FlashcardDeck | null) => void;
  setIsCreateModalOpen: (open: boolean) => void;
  setIsCardModalOpen: (open: boolean) => void;
  setIsGenerateModalOpen: (open: boolean) => void;
  setIsStudyMode: (mode: boolean) => void;
  setCurrentCardIndex: (index: number) => void;
  setIsFlipped: (flipped: boolean) => void;
  setDeckName: (name: string) => void;
  setCardFront: (front: string) => void;
  setCardBack: (back: string) => void;
  setGenerateTopic: (topic: string) => void;
  setGenerateCount: (count: number) => void;
  setGenerateDifficulty: (d: 'beginner' | 'intermediate' | 'advanced') => void;
  setGenerateLanguage: (lang: 'ja' | 'en') => void;
  setSchedulePreview: (preview: SchedulePreview | null) => void;
  // Actions (forwarded from useFlashcardApi)
  fetchDeck: (id: number) => Promise<void>;
  handleCreateDeck: (e: React.FormEvent) => Promise<void>;
  handleDeleteDeck: (id: number) => Promise<void>;
  handleAddCard: (e: React.FormEvent) => Promise<void>;
  handleDeleteCard: (cardId: number) => Promise<void>;
  handleReview: (quality: number) => Promise<void>;
  fetchSchedulePreview: (cardId: number) => Promise<void>;
  startStudy: () => void;
  handleGenerateCards: (e: React.FormEvent) => Promise<void>;
  formatInterval: (dateStr: string) => string;
}

/**
 * Manages all state and API calls for the flashcard page.
 *
 * @returns UseFlashcardsReturn
 */
export function useFlashcards(): UseFlashcardsReturn {
  const [decks, setDecks] = useState<FlashcardDeck[]>([]);
  const [selectedDeck, setSelectedDeck] = useState<FlashcardDeck | null>(null);
  const [loading, setLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isCardModalOpen, setIsCardModalOpen] = useState(false);
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [isStudyMode, setIsStudyMode] = useState(false);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [deckName, setDeckName] = useState('');
  // NOTE: color picker is not yet exposed in UI; value is fixed until design supports it.
  const [deckColor] = useState('#3B82F6');
  const [cardFront, setCardFront] = useState('');
  const [cardBack, setCardBack] = useState('');
  const [generateTopic, setGenerateTopic] = useState('');
  const [generateCount, setGenerateCount] = useState(10);
  const [generateDifficulty, setGenerateDifficulty] = useState<
    'beginner' | 'intermediate' | 'advanced'
  >('intermediate');
  const [generateLanguage, setGenerateLanguage] = useState<'ja' | 'en'>('ja');
  const [isGenerating, setIsGenerating] = useState(false);
  const [schedulePreview, setSchedulePreview] = useState<SchedulePreview | null>(null);

  const {
    fetchDecks,
    fetchDeck,
    handleCreateDeck,
    handleDeleteDeck,
    handleAddCard,
    handleDeleteCard,
    handleReview,
    fetchSchedulePreview,
    handleGenerateCards,
  } = useFlashcardApi(
    {
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
    },
    {
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
    },
  );

  useEffect(() => {
    fetchDecks();
  }, [fetchDecks]);

  /** Start a study session from the first card in the selected deck. */
  const startStudy = useCallback(() => {
    if (!selectedDeck?.cards?.length) return;
    setCurrentCardIndex(0);
    setIsFlipped(false);
    setSchedulePreview(null);
    setIsStudyMode(true);
  }, [selectedDeck]);

  /**
   * Format a future ISO due-date string as a compact human-readable interval.
   *
   * @param dateStr - ISO 8601 due date / <次回復習日時（ISO 8601）>
   * @returns Short label like "10m", "2h", "5d" / <短い間隔表示>
   */
  const formatInterval = useCallback((dateStr: string): string => {
    const now = new Date();
    const due = new Date(dateStr);
    const diffMs = due.getTime() - now.getTime();
    const diffMin = Math.round(diffMs / 60000);
    const diffHours = Math.round(diffMs / 3600000);
    const diffDays = Math.round(diffMs / 86400000);

    if (diffMin < 1) return '<1m';
    if (diffMin < 60) return `${diffMin}m`;
    if (diffHours < 24) return `${diffHours}h`;
    return `${diffDays}d`;
  }, []);

  return {
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
  };
}
