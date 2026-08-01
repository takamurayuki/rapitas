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

/** One point of the personal retention curve (GET /vocab/analytics). */
export interface RetentionPoint {
  key: string;
  midDays: number;
  rate: number | null;
  reference: number;
  samples: number;
}

/** Recall rate for one time-of-day period. */
export interface HourPoint {
  key: 'morning' | 'daytime' | 'evening' | 'night';
  rate: number | null;
  samples: number;
}

/** Learning analytics payload from GET /vocab/analytics. */
export interface VocabAnalytics {
  totalReviews: number;
  retentionReviews: number;
  overallRetention: number | null;
  stability: number | null;
  curve: RetentionPoint[];
  hours: HourPoint[];
  hardest: Array<{ id: number; front: string; back: string; lapses: number }>;
  recommendations: Array<{ key: string; params?: Record<string, string | number> }>;
}
