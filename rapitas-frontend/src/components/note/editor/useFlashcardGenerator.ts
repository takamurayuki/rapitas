'use client';
// useFlashcardGenerator
import { useState, useCallback } from 'react';
import { API_BASE_URL } from '@/utils/api';

/**
 * Result returned by the flashcard generation API endpoint.
 */
export interface FlashcardResult {
  deckId: number;
  deckName: string;
  cardsCreated: number;
}

/**
 * Values returned by useFlashcardGenerator.
 */
export interface FlashcardGeneratorState {
  isGeneratingFlashcards: boolean;
  flashcardResult: FlashcardResult | null;
  handleGenerateFlashcards: () => Promise<void>;
}

/**
 * Manages flashcard generation from the current note content.
 *
 * @param getContent - Function that returns the current HTML content of the editor.
 * @param noteTitle - Title of the note, used as the default deck name.
 * @param locale - Locale string sent to the API for language-aware card generation.
 * @returns Loading state, result, and the trigger function.
 */
export function useFlashcardGenerator(
  getContent: () => string | undefined,
  noteTitle: string,
  locale: string,
): FlashcardGeneratorState {
  const [isGeneratingFlashcards, setIsGeneratingFlashcards] = useState(false);
  const [flashcardResult, setFlashcardResult] =
    useState<FlashcardResult | null>(null);

  const handleGenerateFlashcards = useCallback(async () => {
    const content = getContent();
    if (!content || content.trim().length < 20) return;

    setIsGeneratingFlashcards(true);
    setFlashcardResult(null);
    try {
      const res = await fetch(`${API_BASE_URL}/flashcards/generate-from-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: content,
          deckName: noteTitle || undefined,
          count: 10,
          language: locale,
          difficulty: 'intermediate',
        }),
      });
      if (!res.ok) throw new Error('Failed to generate flashcards');
      const data = await res.json();
      setFlashcardResult({
        deckId: data.deckId,
        deckName: data.deckName,
        cardsCreated: data.cardsCreated,
      });
    } catch {
      setFlashcardResult(null);
    } finally {
      setIsGeneratingFlashcards(false);
    }
  }, [getContent, noteTitle, locale]);

  return { isGeneratingFlashcards, flashcardResult, handleGenerateFlashcards };
}
