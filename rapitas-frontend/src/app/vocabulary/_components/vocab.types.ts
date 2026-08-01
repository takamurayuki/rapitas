/**
 * vocab.types
 *
 * Shared types for the vocabulary book (単語帳) pages.
 */

/** Deck summary as returned by GET /vocab/decks. */
export interface VocabDeckSummary {
  id: number;
  name: string;
  description: string | null;
  cardCount: number;
  dueCount: number;
  updatedAt: string;
}

/** A flashcard with its SRS state. */
export interface VocabCard {
  id: number;
  deckId: number;
  front: string;
  back: string;
  note: string | null;
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
  lapses: number;
  dueAt: string;
  reviewedAt: string | null;
  createdAt: string;
}

/** Deck detail as returned by GET /vocab/decks/:id. */
export interface VocabDeckDetail {
  id: number;
  name: string;
  description: string | null;
  cards: VocabCard[];
  dueCount: number;
}

/** Self-assessment grades for a review. */
export type VocabGrade = 'again' | 'good' | 'easy';
