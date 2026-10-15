/**
 * Consolidation Chunking
 *
 * Pure helpers that split a consolidation group into token-bounded chunks so each LLM call
 * stays under the Claude CLI context limit. It does no I/O and knows nothing about Prisma.
 */
import { estimateTokens } from '../../utils/ai-client/prompt-size-guard';

/** Per-chunk ceiling in estimated tokens; below the 150k guard so the guard is not the normal path. */
export const CHUNK_MAX_TOKENS = 120_000;

// Instruction text and index/separator markup wrapped around the entries in the prompt.
const PROMPT_OVERHEAD_TOKENS = 1_000;

/**
 * Chunks processed per group per run. Bounds nightly LLM calls (3 x 120k tokens per group);
 * the rest waits for the next run.
 */
export const MAX_CHUNKS_PER_GROUP = 3;

const SEPARATOR = '\n\n';

/** Minimal entry shape needed for chunking. */
export interface ChunkableEntry {
  id: number;
  title: string;
  content: string;
}

/**
 * Render one entry as a prompt line.
 *
 * @param entry - Entry to render / 対象エントリ
 * @param index - Zero-based position within its chunk / チャンク内の0始まり位置
 * @returns Prompt line `[n] title: content` / プロンプト行
 */
export function formatEntryLine(entry: ChunkableEntry, index: number): string {
  return `[${index + 1}] ${entry.title}: ${entry.content}`;
}

/**
 * Split entries into chunks whose rendered prompt stays within CHUNK_MAX_TOKENS.
 *
 * Order is preserved. An entry too large for any chunk is truncated and placed alone, so it
 * cannot fail forever. Entries beyond MAX_CHUNKS_PER_GROUP chunks are returned as deferred.
 *
 * @param entries - Group entries in processing order / 処理順のエントリ
 * @returns Chunks to process now and deferred entries for a later run / 今回分と持ち越し分
 */
export function chunkEntries<T extends ChunkableEntry>(
  entries: T[],
): { chunks: T[][]; deferred: T[] } {
  const budgetChars = (CHUNK_MAX_TOKENS - PROMPT_OVERHEAD_TOKENS) * 2;
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentChars = 0;

  for (let i = 0; i < entries.length; i++) {
    let entry = entries[i];
    let lineChars = formatEntryLine(entry, current.length).length;

    if (lineChars > budgetChars) {
      const overflow = lineChars - budgetChars;
      // NOTE: Content is cut, not the title, so the entry stays identifiable in the summary.
      entry = {
        ...entry,
        content: entry.content.slice(0, Math.max(0, entry.content.length - overflow)),
      };
      lineChars = formatEntryLine(entry, 0).length;
    }

    const added = lineChars + (current.length > 0 ? SEPARATOR.length : 0);
    if (current.length > 0 && currentChars + added > budgetChars) {
      chunks.push(current);
      if (chunks.length >= MAX_CHUNKS_PER_GROUP) return { chunks, deferred: entries.slice(i) };
      current = [];
      currentChars = 0;
    }
    currentChars += current.length > 0 ? lineChars + SEPARATOR.length : lineChars;
    current.push(entry);
  }

  if (current.length > 0) chunks.push(current);
  return { chunks, deferred: [] };
}

/**
 * Estimated tokens of a chunk when rendered as prompt lines.
 *
 * @param chunk - Chunk to measure / 対象チャンク
 * @returns Estimated tokens / トークン見積り
 */
export function estimateChunkTokens(chunk: ChunkableEntry[]): number {
  return estimateTokens(chunk.map((e, i) => formatEntryLine(e, i)).join(SEPARATOR));
}
