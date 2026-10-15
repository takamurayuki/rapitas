/**
 * consolidation テスト
 *
 * Covers runConsolidation with oversized groups: token-bounded chunking, deferral of the
 * remainder to the next run (via `src:` tags), per-chunk failure isolation, and the warn log
 * carrying entry ids, size and consecutive failure count.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

type Row = {
  id: number;
  title: string;
  content: string;
  tags: string;
  category: string;
  themeId: number | null;
  confidence: number;
  sourceType: string;
  forgettingStage: string;
  createdAt: Date;
};

let store: Row[] = [];
let nextId = 1000;
let sendImpl: (prompt: string) => Promise<{ content: string }> = async () => ({
  content: 'タイトル: T\n内容: C',
});
const prompts: string[] = [];
const warnCalls: Array<Record<string, unknown>> = [];

mock.module('../../config/logger', () => {
  const l = {
    info: () => {},
    debug: () => {},
    error: () => {},
    warn: (obj: Record<string, unknown>) => {
      warnCalls.push(obj);
    },
  };
  return { createLogger: () => l, logger: l };
});

mock.module('../../config/database', () => ({
  prisma: {
    consolidationRun: {
      create: () => Promise.resolve({ id: 1, createdAt: new Date() }),
      update: () => Promise.resolve({}),
    },
    knowledgeEntry: {
      findMany: (args: { where: { sourceType: unknown } }) =>
        Promise.resolve(
          args.where.sourceType === 'consolidated'
            ? store.filter((r) => r.sourceType === 'consolidated')
            : store.filter((r) => r.sourceType !== 'consolidated'),
        ),
      create: (args: { data: Partial<Row> }) => {
        const row = {
          id: nextId++,
          createdAt: new Date(),
          forgettingStage: 'active',
          themeId: null,
          confidence: 1,
          ...args.data,
        } as Row;
        store.push(row);
        return Promise.resolve(row);
      },
    },
  },
}));

mock.module('./timeline', () => ({ appendEvent: () => Promise.resolve() }));

mock.module('../../utils/ai-client', () => ({
  sendAIMessage: (req: { messages: Array<{ content: string }> }) => {
    const prompt = req.messages[0].content;
    prompts.push(prompt);
    return sendImpl(prompt);
  },
}));

const { runConsolidation, resetConsolidationFailureState } = await import('./consolidation');

// 200k tokens is the Claude CLI hard limit the incident exceeded.
const CLI_LIMIT_TOKENS = 200_000;

function seed(count: number, chars: number): void {
  store = Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    title: `entry ${i + 1}`,
    content: '日'.repeat(chars),
    tags: '[]',
    category: 'pattern',
    themeId: null,
    confidence: 1,
    sourceType: 'task_pattern',
    forgettingStage: 'active',
    createdAt: new Date(),
  }));
}

beforeEach(() => {
  store = [];
  nextId = 1000;
  prompts.length = 0;
  warnCalls.length = 0;
  resetConsolidationFailureState();
  sendImpl = async () => ({ content: 'タイトル: T\n内容: C' });
});

describe('runConsolidation with an oversized group', () => {
  test('splits into several calls, each prompt within the chunk limit', async () => {
    seed(60, 10_000); // ~300k estimated tokens in one group
    const result = await runConsolidation();
    expect(prompts.length).toBeGreaterThan(1);
    for (const p of prompts) expect(Math.ceil(p.length / 2)).toBeLessThanOrEqual(120_000);
    expect(result.created).toBe(prompts.length);
    expect(result.merged).toBe(60);
  });

  test('defers chunks beyond the per-run cap and picks them up next run without re-merging', async () => {
    seed(100, 10_000); // ~500k tokens, more than 3 chunks
    const first = await runConsolidation();
    expect(first.created).toBe(3);
    expect(first.merged).toBeLessThan(100);

    const second = await runConsolidation();
    // Already-merged entries carry src: tags and must not be sent again.
    expect(second.merged).toBeGreaterThan(0);
    expect(first.merged + second.merged).toBeLessThanOrEqual(100);

    const third = await runConsolidation();
    expect(first.merged + second.merged + third.merged).toBe(100);

    const before = prompts.length;
    const fourth = await runConsolidation();
    expect(fourth.created).toBe(0);
    expect(prompts.length).toBe(before);
  });

  test('a failing chunk does not discard the others and is logged with id, size and streak', async () => {
    seed(60, 10_000);
    let call = 0;
    sendImpl = async () => {
      call++;
      if (call === 1) throw new Error('Prompt is too long');
      return { content: 'タイトル: T\n内容: C' };
    };
    const result = await runConsolidation();
    expect(result.created).toBe(prompts.length - 1);

    const warn = warnCalls.find((w) => w.groupKey === 'pattern:null');
    expect(warn).toBeDefined();
    expect(Array.isArray(warn!.entryIds) && (warn!.entryIds as number[]).length).toBeGreaterThan(0);
    expect(warn!.estimatedTokens).toBeGreaterThan(0);
    expect(warn!.consecutiveFailures).toBe(1);
  });

  test('counts consecutive failures across runs and resets on success', async () => {
    seed(6, 10);
    sendImpl = async () => {
      throw new Error('down');
    };
    await runConsolidation();
    await runConsolidation();
    const streaks = warnCalls.map((w) => w.consecutiveFailures);
    expect(streaks).toEqual([1, 2]);

    sendImpl = async () => ({ content: 'タイトル: T\n内容: C' });
    await runConsolidation();
    sendImpl = async () => {
      throw new Error('down again');
    };
    seed(6, 10);
    warnCalls.length = 0;
    await runConsolidation();
    expect(warnCalls[0].consecutiveFailures).toBe(1);
  });

  test('success rate: single-prompt (old) fails on a huge group, chunked (new) succeeds', async () => {
    seed(100, 10_000);
    const limited = async (prompt: string) => {
      if (Math.ceil(prompt.length / 2) > CLI_LIMIT_TOKENS) throw new Error('Prompt is too long');
      return { content: 'タイトル: T\n内容: C' };
    };
    // Old behaviour: every entry in one prompt.
    const oldPrompt = store.map((e, i) => `[${i + 1}] ${e.title}: ${e.content}`).join('\n\n');
    await expect(limited(oldPrompt)).rejects.toThrow('Prompt is too long');

    sendImpl = limited;
    const result = await runConsolidation();
    expect(warnCalls.length).toBe(0);
    expect(result.created).toBe(prompts.length);
    expect(result.created).toBeGreaterThan(0);
  });
});
