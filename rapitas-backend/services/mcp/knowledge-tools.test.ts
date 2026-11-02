/**
 * knowledge-tools.test
 *
 * The knowledge base is the largest thing Rapitas holds — 13,760 entries
 * measured on 2026-10-31, 85× the task count — and it was not exposed over
 * MCP at all (#1318). What matters here is that the tool hands a model
 * something it can act on: a bounded number of hits, a score that does not
 * read as "irrelevant" when the lexical channel found it, and no NaN reaching
 * Prisma from a malformed argument.
 */
import { describe, expect, it, mock, beforeEach } from 'bun:test';
import type { HybridHit, HybridSearchOptions } from '../memory/recall/hybrid-search';

const searchCalls: HybridSearchOptions[] = [];
let nextHits: HybridHit[] = [];

const searchKnowledgeHybrid = mock(async (options: HybridSearchOptions): Promise<HybridHit[]> => {
  searchCalls.push(options);
  return nextHits;
});

// NOTE: The real module is spread in so every export is mirrored. Bun's
// mock.module replaces the whole module, and a missing export makes this file
// stop with one error and its tests vanish (CLAUDE.md § Adding an export).
const actualSearch = await import('../memory/recall/hybrid-search');
mock.module('../memory/recall/hybrid-search', () => ({
  ...actualSearch,
  searchKnowledgeHybrid,
}));

const { KNOWLEDGE_TOOL_DEFINITIONS, executeKnowledgeTool } = await import('./knowledge-tools');

function hit(overrides: Partial<HybridHit> = {}): HybridHit {
  return {
    id: 1,
    title: 'Bun test needs --isolate',
    content: 'Plain bun test leaks mock.module process-globally.',
    category: 'lesson',
    confidence: 0.8,
    forgettingStage: 'active',
    similarity: 0.755,
    tags: [],
    createdAt: new Date('2026-10-01T00:00:00Z'),
    taskId: null,
    validationStatus: 'validated',
    channel: 'vector',
    lexicalScore: null,
    ...overrides,
  };
}

/** The text of a successful single-block result. */
async function runSearch(args: Record<string, string>): Promise<string> {
  const result = await executeKnowledgeTool('rapitas_search_knowledge', args);
  if (result === null) throw new Error('the tool was not routed');
  return result.content[0].text;
}

beforeEach(() => {
  searchCalls.length = 0;
  nextHits = [];
  searchKnowledgeHybrid.mockClear();
});

describe('definitions', () => {
  it('declares rapitas_search_knowledge with q required', () => {
    const tool = KNOWLEDGE_TOOL_DEFINITIONS.find((t) => t.name === 'rapitas_search_knowledge');
    expect(tool).toBeDefined();
    expect(tool?.inputSchema.required).toEqual(['q']);
  });

  it('tells the caller to search before solving, not just what the tool does', () => {
    const tool = KNOWLEDGE_TOOL_DEFINITIONS[0];
    // The description is the only thing steering a model to use this at all.
    expect(tool.description).toContain('BEFORE');
  });
});

describe('argument handling', () => {
  it('defaults the limit rather than letting the search decide', async () => {
    await runSearch({ q: 'isolate' });
    expect(searchCalls[0].limit).toBe(5);
  });

  it('caps a large limit so one result cannot fill the caller context', async () => {
    await runSearch({ q: 'isolate', limit: '1000' });
    expect(searchCalls[0].limit).toBe(20);
  });

  it('falls back to the default on a limit that is not a number', async () => {
    await runSearch({ q: 'isolate', limit: 'all' });
    expect(searchCalls[0].limit).toBe(5);
  });

  it('drops a themeId that is not a positive integer instead of passing NaN', async () => {
    // parseInt('abc') is NaN, and NaN in a Prisma where is a runtime error —
    // the tool must not turn a bad argument into a 500.
    await runSearch({ q: 'isolate', themeId: 'abc' });
    expect(searchCalls[0].themeId).toBeUndefined();

    await runSearch({ q: 'isolate', themeId: '0' });
    expect(searchCalls[1].themeId).toBeUndefined();

    await runSearch({ q: 'isolate', themeId: '46' });
    expect(searchCalls[2].themeId).toBe(46);
  });

  it('records the recall as coming from mcp, not from the app API', async () => {
    await runSearch({ q: 'isolate' });
    expect(searchCalls[0].telemetry).toEqual({ source: 'mcp' });
  });

  it('trims the query', async () => {
    await runSearch({ q: '  isolate  ' });
    expect(searchCalls[0].query).toBe('isolate');
  });

  it('rejects an empty query as an error without searching', async () => {
    const result = await executeKnowledgeTool('rapitas_search_knowledge', { q: '   ' });
    expect(result?.isError).toBe(true);
    expect(searchKnowledgeHybrid).not.toHaveBeenCalled();
  });
});

describe('result text', () => {
  it('reports no match as a plain answer, not an error', async () => {
    const result = await executeKnowledgeTool('rapitas_search_knowledge', { q: 'nothing here' });
    expect(result?.isError).toBeUndefined();
    expect(result?.content[0].text).toContain('No knowledge matched');
  });

  it('carries the id, title and similarity of each hit', async () => {
    nextHits = [hit({ id: 42 })];
    const text = await runSearch({ q: 'isolate' });

    expect(text).toContain('#42 Bun test needs --isolate');
    expect(text).toContain('similarity 0.755');
    expect(text).toContain('1 hit(s)');
  });

  // hybrid-search sets similarity to 0 for a lexical-only hit. Printing
  // "similarity 0.000" would tell the model the entry is irrelevant, when the
  // lexical channel is what found it.
  it('names the lexical channel instead of printing a zero similarity', async () => {
    nextHits = [hit({ channel: 'lexical', similarity: 0, lexicalScore: 0.62 })];
    const text = await runSearch({ q: 'isolate' });

    expect(text).toContain('lexical 0.62');
    expect(text).not.toContain('similarity 0.000');
  });

  it('truncates a long body and says it did', async () => {
    nextHits = [hit({ content: 'x'.repeat(5_000) })];
    const text = await runSearch({ q: 'isolate' });

    expect(text.length).toBeLessThan(1_000);
    expect(text).toContain('…');
  });

  it('flattens newlines so one entry cannot reflow the whole result', async () => {
    nextHits = [hit({ content: 'first\n\n\nsecond' })];
    const text = await runSearch({ q: 'isolate' });
    expect(text).toContain('first second');
  });
});

describe('routing', () => {
  it('returns null for a tool it does not own', async () => {
    expect(await executeKnowledgeTool('rapitas_list_tasks', {})).toBeNull();
  });
});
