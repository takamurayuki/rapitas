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

/** A related word (synonym or antonym) attached to one sense. */
export interface VocabRelatedWord {
  word: string;
  /** Nuance note — how this synonym differs. / ニュアンスの違い。 */
  nuance?: string;
  example?: string;
  exampleJa?: string;
}

/** One sense (語義) of a word: meaning + example + related words. */
export interface VocabSense {
  meaning: string;
  example?: string;
  exampleJa?: string;
  synonyms: VocabRelatedWord[];
  antonyms: VocabRelatedWord[];
}

/** A flashcard with its SRS state and optional dictionary enrichment. */
export interface VocabCard {
  id: number;
  deckId: number;
  front: string;
  back: string;
  note: string | null;
  syllables: string | null;
  pronunciation: string | null;
  partOfSpeech: string | null;
  /** JSON-serialized VocabSense[] — use parseSenses() to read. */
  details: string | null;
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
  lapses: number;
  dueAt: string;
  reviewedAt: string | null;
  createdAt: string;
}

/**
 * Parse a card's details JSON into senses, tolerating malformed data.
 *
 * @param details - Raw JSON string from the card / カードのdetails文字列
 * @returns Parsed senses, [] when absent or invalid / 解析済み語義リスト
 */
export function parseSenses(details: string | null | undefined): VocabSense[] {
  if (!details) return [];
  try {
    const parsed = JSON.parse(details) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s): s is VocabSense => typeof s === 'object' && s !== null && 'meaning' in s)
      .map((s) => ({
        meaning: String(s.meaning ?? ''),
        example: s.example ? String(s.example) : undefined,
        exampleJa: s.exampleJa ? String(s.exampleJa) : undefined,
        synonyms: Array.isArray(s.synonyms) ? s.synonyms : [],
        antonyms: Array.isArray(s.antonyms) ? s.antonyms : [],
      }));
  } catch {
    return [];
  }
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
