/**
 * consolidation-chunking tests
 *
 * Verifies token-bounded chunking of consolidation groups.
 */
import { describe, expect, test } from 'bun:test';
import { estimateTokens } from '../../utils/ai-client/prompt-size-guard';
import {
  CHUNK_MAX_TOKENS,
  MAX_CHUNKS_PER_GROUP,
  chunkEntries,
  formatEntryLine,
  type ChunkableEntry,
} from './consolidation-chunking';

function entry(id: number, contentChars: number): ChunkableEntry {
  return { id, title: `t${id}`, content: '日'.repeat(contentChars) };
}

function chunkTokens(chunk: ChunkableEntry[]): number {
  return estimateTokens(chunk.map((e) => formatEntryLine(e, 0)).join('\n\n'));
}

describe('chunkEntries', () => {
  test('returns no chunks for an empty list', () => {
    expect(chunkEntries([])).toEqual({ chunks: [], deferred: [] });
  });

  test('keeps a small group in one chunk, preserving order', () => {
    const entries = [entry(1, 10), entry(2, 10), entry(3, 10)];
    const { chunks, deferred } = chunkEntries(entries);
    expect(chunks.length).toBe(1);
    expect(chunks[0].map((e) => e.id)).toEqual([1, 2, 3]);
    expect(deferred).toEqual([]);
  });

  test('splits a Japanese group of 240k chars into chunks all within the limit', () => {
    const entries = Array.from({ length: 24 }, (_, i) => entry(i + 1, 10_000));
    const { chunks, deferred } = chunkEntries(entries);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(chunkTokens(c)).toBeLessThanOrEqual(CHUNK_MAX_TOKENS);
    const all = [...chunks.flat(), ...deferred].map((e) => e.id);
    expect(all).toEqual(entries.map((e) => e.id));
  });

  test('truncates a single oversized entry into its own chunk', () => {
    const { chunks } = chunkEntries([entry(1, 10), entry(2, 1_000_000), entry(3, 10)]);
    for (const c of chunks) expect(chunkTokens(c)).toBeLessThanOrEqual(CHUNK_MAX_TOKENS);
    const big = chunks.flat().find((e) => e.id === 2);
    expect(big).toBeDefined();
    expect(big!.content.length).toBeLessThan(1_000_000);
    expect(chunks.find((c) => c.some((e) => e.id === 2))!.length).toBe(1);
  });

  test('defers entries beyond MAX_CHUNKS_PER_GROUP chunks', () => {
    // Each entry nearly fills a chunk by itself.
    const entries = Array.from({ length: MAX_CHUNKS_PER_GROUP + 2 }, (_, i) =>
      entry(i + 1, CHUNK_MAX_TOKENS * 2 - 200),
    );
    const { chunks, deferred } = chunkEntries(entries);
    expect(chunks.length).toBe(MAX_CHUNKS_PER_GROUP);
    expect(deferred.map((e) => e.id)).toEqual([MAX_CHUNKS_PER_GROUP + 1, MAX_CHUNKS_PER_GROUP + 2]);
  });
});
