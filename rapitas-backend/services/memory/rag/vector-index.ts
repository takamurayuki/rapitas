/**
 * Vector Index Management
 *
 * Manages embeddings in SQLite and performs brute-force cosine similarity search.
 */
import { Database } from 'bun:sqlite';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { createLogger } from '../../../config/logger';
import { cosineSimilarity } from '../utils';
import type { VectorSearchResult } from '../types';

const log = createLogger('memory:rag:vector-index');

const DB_DIR = join(__dirname, '../../../data');
const DB_PATH = join(DB_DIR, 'knowledge-vectors.db');

let db: Database | null = null;

/**
 * Initialize the SQLite database.
 */
function getDb(): Database {
  if (db) return db;

  if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA synchronous=NORMAL');

  db.run(`
    CREATE TABLE IF NOT EXISTS embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      knowledge_entry_id INTEGER NOT NULL UNIQUE,
      embedding BLOB NOT NULL,
      embedding_model TEXT DEFAULT 'Xenova/all-MiniLM-L6-v2',
      dimension INTEGER DEFAULT 384,
      text_preview TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_embeddings_entry_id
    ON embeddings(knowledge_entry_id)
  `);

  log.info({ path: DB_PATH }, 'Vector index database initialized');
  return db;
}

/**
 * Convert embedding array to a Buffer (Float32Array blob) for storage.
 */
function embeddingToBlob(embedding: number[]): Buffer {
  const float32 = new Float32Array(embedding);
  return Buffer.from(float32.buffer);
}

/**
 * Restore a number array from a Float32Array blob.
 */
function blobToEmbedding(blob: Buffer): number[] {
  const float32 = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
  return Array.from(float32);
}

/**
 * Insert or update an embedding.
 */
export function upsertEmbedding(
  knowledgeEntryId: number,
  embedding: number[],
  textPreview?: string,
  model = 'Xenova/all-MiniLM-L6-v2',
): void {
  const database = getDb();
  const blob = embeddingToBlob(embedding);

  const stmt = database.prepare(`
    INSERT INTO embeddings (knowledge_entry_id, embedding, embedding_model, dimension, text_preview)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(knowledge_entry_id)
    DO UPDATE SET embedding = ?, embedding_model = ?, text_preview = ?, created_at = datetime('now')
  `);

  stmt.run(
    knowledgeEntryId,
    blob,
    model,
    embedding.length,
    textPreview?.slice(0, 200) ?? null,
    blob,
    model,
    textPreview?.slice(0, 200) ?? null,
  );
}

/**
 * Delete an embedding.
 */
export function deleteEmbedding(knowledgeEntryId: number): void {
  const database = getDb();
  database.run('DELETE FROM embeddings WHERE knowledge_entry_id = ?', [knowledgeEntryId]);
}

/**
 * Brute-force search by cosine similarity.
 */
export function searchSimilar(
  queryEmbedding: number[],
  limit = 10,
  minSimilarity = 0.5,
  excludeIds: number[] = [],
  model?: string,
): VectorSearchResult[] {
  const database = getDb();

  // NOTE (determinism): SQLite does not guarantee a scan order without an
  // ORDER BY — ordering by the table's own `id` primary key makes repeated
  // scans of an unchanged table return rows in the same order, so the
  // similarity-tie-break below is reproducible run-to-run.
  // NOTE: `model` restricts the scan to rows embedded by that model — cosine
  // between vectors of different models is meaningless, so during a model
  // migration only same-model rows may be compared with the query.
  const rows = (
    model === undefined
      ? database
          .query(
            'SELECT knowledge_entry_id, embedding, text_preview FROM embeddings ORDER BY id ASC',
          )
          .all()
      : database
          .query(
            'SELECT knowledge_entry_id, embedding, text_preview FROM embeddings WHERE embedding_model = ? ORDER BY id ASC',
          )
          .all(model)
  ) as Array<{
    knowledge_entry_id: number;
    embedding: Buffer;
    text_preview: string | null;
  }>;

  const results: VectorSearchResult[] = [];

  for (const row of rows) {
    if (excludeIds.includes(row.knowledge_entry_id)) continue;

    const storedEmbedding = blobToEmbedding(row.embedding);
    const similarity = cosineSimilarity(queryEmbedding, storedEmbedding);

    if (similarity >= minSimilarity) {
      results.push({
        knowledgeEntryId: row.knowledge_entry_id,
        similarity,
        textPreview: row.text_preview,
      });
    }
  }

  // Sort by similarity descending and truncate to limit. Tie-break on
  // knowledgeEntryId — Array#sort ties are not guaranteed stable across
  // engines, so an explicit tiebreak keeps the truncated top-`limit` set
  // (and thus the prompt built from it) identical across repeated runs.
  results.sort((a, b) => b.similarity - a.similarity || a.knowledgeEntryId - b.knowledgeEntryId);
  return results.slice(0, limit);
}

/**
 * Get the total number of stored embeddings.
 */
export function getEmbeddingCount(): number {
  const database = getDb();
  const result = database.query('SELECT COUNT(*) as count FROM embeddings').get() as {
    count: number;
  };
  return result.count;
}

/**
 * Count stored embeddings per model name (migration progress signal).
 *
 * @returns Map of embedding_model → row count. / モデル別件数
 */
export function countEmbeddingsByModel(): Record<string, number> {
  const database = getDb();
  const rows = database
    .query(
      'SELECT embedding_model AS model, COUNT(*) AS count FROM embeddings GROUP BY embedding_model',
    )
    .all() as Array<{ model: string | null; count: number }>;
  const out: Record<string, number> = {};
  for (const r of rows) out[r.model ?? ''] = r.count;
  return out;
}

/** SQLite's default max host parameters is 999; stay well under it. */
const IN_CHUNK = 500;

/**
 * Look up which model each entry's stored embedding was produced by.
 * Entries without an embedding are absent from the map.
 *
 * @param ids - Knowledge entry ids. / 対象ID
 * @returns entryId → embedding_model. / ID→モデル名
 */
export function getEmbeddingModels(ids: number[]): Map<number, string> {
  const out = new Map<number, string>();
  if (ids.length === 0) return out;
  const database = getDb();
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = database
      .query(
        `SELECT knowledge_entry_id AS id, embedding_model AS model FROM embeddings WHERE knowledge_entry_id IN (${placeholders})`,
      )
      .all(...chunk) as Array<{ id: number; model: string | null }>;
    for (const r of rows) out.set(r.id, r.model ?? '');
  }
  return out;
}

/**
 * Close the database connection.
 */
export function closeVectorDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
