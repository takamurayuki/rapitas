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

/** One inflected form (語形変化の1項目) with its own example / explanation. */
export interface VocabConjugationEntry {
  form: string;
  example?: string;
  note?: string;
}

/** Inflection table (語形変化) — all fields optional. */
export interface VocabConjugations {
  base?: VocabConjugationEntry;
  third?: VocabConjugationEntry;
  ing?: VocabConjugationEntry;
  past?: VocabConjugationEntry;
  pastParticiple?: VocabConjugationEntry;
}

/** Ordered keys for rendering/editing the conjugation table. */
export const CONJUGATION_KEYS = ['base', 'third', 'ing', 'past', 'pastParticiple'] as const;

/** Key union for the conjugation table. */
export type ConjugationKey = (typeof CONJUGATION_KEYS)[number];

/** Parsed shape of a card's details JSON. */
export interface VocabCardDetails {
  senses: VocabSense[];
  conjugations: VocabConjugations | null;
}

const sanitizeSenses = (raw: unknown): VocabSense[] =>
  (Array.isArray(raw) ? raw : [])
    .filter((s): s is VocabSense => typeof s === 'object' && s !== null && 'meaning' in s)
    .map((s) => ({
      meaning: String(s.meaning ?? ''),
      example: s.example ? String(s.example) : undefined,
      exampleJa: s.exampleJa ? String(s.exampleJa) : undefined,
      synonyms: Array.isArray(s.synonyms) ? s.synonyms : [],
      antonyms: Array.isArray(s.antonyms) ? s.antonyms : [],
    }));

/**
 * Parse a card's details JSON, tolerating malformed data and both formats:
 * the legacy bare `VocabSense[]` array and the current
 * `{ senses, conjugations }` object.
 *
 * @param details - Raw JSON string from the card / カードのdetails文字列
 * @returns Senses plus the optional conjugation table / 語義と語形変化
 */
export function parseCardDetails(details: string | null | undefined): VocabCardDetails {
  if (!details) return { senses: [], conjugations: null };
  try {
    const parsed = JSON.parse(details) as unknown;
    if (Array.isArray(parsed)) return { senses: sanitizeSenses(parsed), conjugations: null };
    if (typeof parsed === 'object' && parsed !== null) {
      const obj = parsed as { senses?: unknown; conjugations?: Record<string, unknown> };
      const conj: VocabConjugations = {};
      for (const key of CONJUGATION_KEYS) {
        const v = obj.conjugations?.[key];
        // Legacy format stored a bare string; current format stores an entry
        // object with its own example / explanation.
        if (typeof v === 'string' && v.trim()) {
          conj[key] = { form: v };
        } else if (typeof v === 'object' && v !== null) {
          const e = v as Record<string, unknown>;
          if (typeof e.form === 'string' && e.form.trim()) {
            conj[key] = {
              form: e.form,
              ...(typeof e.example === 'string' && e.example.trim() && { example: e.example }),
              ...(typeof e.note === 'string' && e.note.trim() && { note: e.note }),
            };
          }
        }
      }
      return {
        senses: sanitizeSenses(obj.senses),
        conjugations: Object.keys(conj).length > 0 ? conj : null,
      };
    }
    return { senses: [], conjugations: null };
  } catch {
    return { senses: [], conjugations: null };
  }
}

/**
 * Parse just the senses from a card's details JSON.
 *
 * @param details - Raw JSON string from the card / カードのdetails文字列
 * @returns Parsed senses, [] when absent or invalid / 解析済み語義リスト
 */
export function parseSenses(details: string | null | undefined): VocabSense[] {
  return parseCardDetails(details).senses;
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
