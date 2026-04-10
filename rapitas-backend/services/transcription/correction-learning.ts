/**
 * Transcription Correction Learning
 *
 * Learns from user corrections to Whisper output and applies them
 * automatically on future transcriptions. Stores correction patterns
 * in SQLite for fast lookup.
 *
 * Flow:
 *   1. Whisper outputs raw text
 *   2. applyCorrections() replaces known patterns
 *   3. User sees corrected text, may further edit
 *   4. If user edits, recordCorrection() stores the diff
 *   5. Next transcription benefits from accumulated corrections
 */
import { Database } from 'bun:sqlite';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { createLogger } from '../../config';

const log = createLogger('transcription:correction-learning');

const DB_DIR = join(__dirname, '../../data');
const DB_PATH = join(DB_DIR, 'transcription-corrections.db');

let db: Database | null = null;

/**
 * Initialize the corrections database.
 */
function getDb(): Database {
  if (db) return db;

  if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS corrections (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      wrong_text      TEXT NOT NULL,
      correct_text    TEXT NOT NULL,
      hit_count       INTEGER DEFAULT 1,
      context         TEXT DEFAULT '',
      created_at      TEXT DEFAULT (datetime('now')),
      last_used_at    TEXT DEFAULT (datetime('now')),
      UNIQUE(wrong_text, correct_text)
    );
    CREATE INDEX IF NOT EXISTS idx_corrections_wrong ON corrections(wrong_text);
    CREATE INDEX IF NOT EXISTS idx_corrections_hits ON corrections(hit_count DESC);
  `);

  log.info('Transcription corrections database initialized');
  return db;
}

/** A stored correction pattern. */
export interface CorrectionPattern {
  id: number;
  wrongText: string;
  correctText: string;
  hitCount: number;
  context: string;
}

/**
 * Record a user correction for learning.
 *
 * Called when the user edits the transcribed text. Extracts word-level
 * diffs and stores each changed word/phrase as a correction pattern.
 *
 * @param rawText - Original Whisper output / Whisperの元出力
 * @param correctedText - User-corrected text / ユーザー修正後テキスト
 */
export function recordCorrection(rawText: string, correctedText: string): void {
  if (rawText === correctedText) return;

  const database = getDb();

  // Extract word-level corrections
  const rawWords = tokenize(rawText);
  const correctedWords = tokenize(correctedText);
  const diffs = extractDiffs(rawWords, correctedWords);

  for (const diff of diffs) {
    if (diff.wrong === diff.correct) continue;
    if (diff.wrong.length === 0 || diff.correct.length === 0) continue;

    try {
      // Upsert: increment hit_count if pattern already exists
      database.prepare(`
        INSERT INTO corrections (wrong_text, correct_text, context)
        VALUES (?, ?, ?)
        ON CONFLICT(wrong_text, correct_text)
        DO UPDATE SET hit_count = hit_count + 1, last_used_at = datetime('now')
      `).run(diff.wrong, diff.correct, diff.context || '');

      log.debug({ wrong: diff.wrong, correct: diff.correct }, 'Correction recorded');
    } catch (error) {
      log.warn({ err: error }, 'Failed to record correction');
    }
  }
}

/**
 * Apply learned corrections to a raw transcription.
 *
 * Replaces known wrong patterns with their corrections, prioritized
 * by hit count (most frequently corrected patterns first).
 *
 * @param rawText - Raw Whisper output / Whisperの生出力
 * @returns Corrected text / 補正後テキスト
 */
export function applyCorrections(rawText: string): string {
  const database = getDb();

  try {
    // Fetch all corrections sorted by length (longest first) to avoid partial replacements,
    // then by hit count to prioritize well-established patterns.
    const patterns = database.prepare(`
      SELECT wrong_text, correct_text, hit_count
      FROM corrections
      WHERE hit_count >= 2
      ORDER BY LENGTH(wrong_text) DESC, hit_count DESC
      LIMIT 500
    `).all() as Array<{ wrong_text: string; correct_text: string; hit_count: number }>;

    if (patterns.length === 0) return rawText;

    let corrected = rawText;

    for (const pattern of patterns) {
      if (corrected.includes(pattern.wrong_text)) {
        // NOTE: split+join instead of replaceAll for ES2020 lib compat (tsconfig target).
        corrected = corrected.split(pattern.wrong_text).join(pattern.correct_text);

        // Update last_used_at
        database.prepare(
          "UPDATE corrections SET last_used_at = datetime('now') WHERE wrong_text = ? AND correct_text = ?",
        ).run(pattern.wrong_text, pattern.correct_text);

        log.debug(
          { wrong: pattern.wrong_text, correct: pattern.correct_text, hits: pattern.hit_count },
          'Auto-correction applied',
        );
      }
    }

    return corrected;
  } catch (error) {
    log.warn({ err: error }, 'Failed to apply corrections');
    return rawText;
  }
}

/**
 * Get all stored correction patterns.
 *
 * @param limit - Maximum patterns to return / 最大件数
 * @returns Correction patterns sorted by hit count / ヒット数順の補正パターン
 */
export function getCorrectionPatterns(limit: number = 100): CorrectionPattern[] {
  try {
    const database = getDb();
    return database.prepare(`
      SELECT id, wrong_text as wrongText, correct_text as correctText,
             hit_count as hitCount, context
      FROM corrections
      ORDER BY hit_count DESC, last_used_at DESC
      LIMIT ?
    `).all(limit) as CorrectionPattern[];
  } catch {
    return [];
  }
}

/**
 * Delete a correction pattern.
 *
 * @param id - Correction ID to delete / 削除する補正ID
 */
export function deleteCorrection(id: number): boolean {
  try {
    const database = getDb();
    database.prepare('DELETE FROM corrections WHERE id = ?').run(id);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get correction statistics.
 */
export function getCorrectionStats(): { totalPatterns: number; totalHits: number; topPatterns: CorrectionPattern[] } {
  try {
    const database = getDb();
    const countRow = database.prepare('SELECT COUNT(*) as cnt FROM corrections').get() as { cnt: number };
    const hitsRow = database.prepare('SELECT COALESCE(SUM(hit_count), 0) as total FROM corrections').get() as { total: number };
    const topPatterns = getCorrectionPatterns(10);

    return {
      totalPatterns: countRow.cnt,
      totalHits: hitsRow.total,
      topPatterns,
    };
  } catch {
    return { totalPatterns: 0, totalHits: 0, topPatterns: [] };
  }
}

// --- Internal helpers ---

/** Tokenize text into words preserving whitespace boundaries. */
function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter((t) => t.length > 0);
}

/** Extract word-level diffs between two token arrays. */
function extractDiffs(
  rawTokens: string[],
  correctedTokens: string[],
): Array<{ wrong: string; correct: string; context?: string }> {
  const diffs: Array<{ wrong: string; correct: string; context?: string }> = [];

  // Simple LCS-based diff for short texts
  const maxLen = Math.max(rawTokens.length, correctedTokens.length);

  if (maxLen > 200) {
    // For long texts, just record the whole thing as one correction
    const raw = rawTokens.join('').trim();
    const corrected = correctedTokens.join('').trim();
    if (raw !== corrected) {
      diffs.push({ wrong: raw, correct: corrected });
    }
    return diffs;
  }

  // Build word-level diff using simple alignment
  let ri = 0;
  let ci = 0;

  while (ri < rawTokens.length && ci < correctedTokens.length) {
    const rawWord = rawTokens[ri].trim();
    const corrWord = correctedTokens[ci].trim();

    if (rawWord === corrWord || rawWord === '' || corrWord === '') {
      ri++;
      ci++;
      continue;
    }

    // Look ahead to find alignment
    const lookAhead = 5;
    let foundRaw = -1;
    let foundCorr = -1;

    for (let k = 1; k <= lookAhead; k++) {
      if (ri + k < rawTokens.length && rawTokens[ri + k].trim() === corrWord) {
        foundRaw = ri + k;
        break;
      }
      if (ci + k < correctedTokens.length && correctedTokens[ci + k].trim() === rawWord) {
        foundCorr = ci + k;
        break;
      }
    }

    if (foundRaw > 0) {
      // Raw has extra words → deletion/replacement
      const wrongParts = rawTokens.slice(ri, foundRaw).join('').trim();
      if (wrongParts) {
        diffs.push({ wrong: wrongParts, correct: '', context: corrWord });
      }
      ri = foundRaw;
    } else if (foundCorr > 0) {
      // Corrected has extra words → insertion
      ci = foundCorr;
    } else {
      // Simple substitution
      if (rawWord && corrWord) {
        diffs.push({
          wrong: rawWord,
          correct: corrWord,
          context: rawTokens.slice(Math.max(0, ri - 2), ri).join('').trim(),
        });
      }
      ri++;
      ci++;
    }
  }

  return diffs;
}

/**
 * Close the corrections database connection.
 */
export function closeCorrectionDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
