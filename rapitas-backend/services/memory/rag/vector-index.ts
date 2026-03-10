/**
 * ベクトルインデックス管理
 * SQLiteでembeddingsを管理し、コサイン類似度でブルートフォース検索
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
 * SQLiteデータベースを初期化
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
 * embeddingをFloat32Arrayに変換してBlobとして保存
 */
function embeddingToBlob(embedding: number[]): Buffer {
  const float32 = new Float32Array(embedding);
  return Buffer.from(float32.buffer);
}

/**
 * BlobからFloat32Arrayに復元
 */
function blobToEmbedding(blob: Buffer): number[] {
  const float32 = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
  return Array.from(float32);
}

/**
 * embeddingを挿入または更新
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
 * embeddingを削除
 */
export function deleteEmbedding(knowledgeEntryId: number): void {
  const database = getDb();
  database.run('DELETE FROM embeddings WHERE knowledge_entry_id = ?', [knowledgeEntryId]);
}

/**
 * コサイン類似度でブルートフォース検索
 */
export function searchSimilar(
  queryEmbedding: number[],
  limit = 10,
  minSimilarity = 0.5,
  excludeIds: number[] = [],
): VectorSearchResult[] {
  const database = getDb();

  const rows = database
    .query('SELECT knowledge_entry_id, embedding, text_preview FROM embeddings')
    .all() as Array<{
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

  // 類似度降順でソートしてlimitで切る
  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, limit);
}

/**
 * エントリ数を取得
 */
export function getEmbeddingCount(): number {
  const database = getDb();
  const result = database.query('SELECT COUNT(*) as count FROM embeddings').get() as {
    count: number;
  };
  return result.count;
}

/**
 * データベースを閉じる
 */
export function closeVectorDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
