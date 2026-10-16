/**
 * idea-qd-gate テスト (R5)
 *
 * 純粋関数（プロンプト生成・判定パース・受理判断・cellタグ抽出）の検証。
 * LLM呼び出しを伴う evaluateIdeaQd はフェイルオープン性のみモックで確認。
 */
import { describe, test, expect, mock } from 'bun:test';

const mockFindMany = mock(() => Promise.resolve([] as unknown[]));
const mockCount = mock(() => Promise.resolve(0));
mock.module('../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: { knowledgeEntry: { findMany: mockFindMany, count: mockCount } },
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
const mockSendAIMessage = mock(() => Promise.resolve({ content: '', tokensUsed: 0 }));
mock.module('../../utils/ai-client', () => ({
  sendAIMessage: mockSendAIMessage,
}));

const { buildQdJudgePrompt, parseQdVerdict, decideQdAcceptance, parseCellTag, evaluateIdeaQd } =
  await import('../../services/memory/idea-qd-gate');

type Neighbor = { id: number; title: string; content: string; cell: string | null };
const neighbor = (id: number, title: string, cell: string | null = null): Neighbor => ({
  id,
  title,
  content: 'c',
  cell,
});

describe('buildQdJudgePrompt', () => {
  test('候補と近傍(id/cell付き)が本文に入り、JSON出力を指示すること', () => {
    const p = buildQdJudgePrompt({
      title: '新アイデア',
      content: '内容X',
      neighbors: [neighbor(7, '既存A', 'ui/改善/エンドユーザー')],
    });
    expect(p).toContain('新アイデア');
    expect(p).toContain('内容X');
    expect(p).toContain('id=7');
    expect(p).toContain('ui/改善/エンドユーザー');
    expect(p).toContain('novelty');
    expect(p).toContain('beatsIncumbents');
  });
});

describe('parseQdVerdict', () => {
  test('素のJSONを解釈する', () => {
    const v = parseQdVerdict(
      '{"novelty":"new","duplicateOfId":null,"cell":"ui/改善/開発者","beatsIncumbents":false}',
    );
    expect(v).toEqual({
      novelty: 'new',
      duplicateOfId: null,
      cell: 'ui/改善/開発者',
      beatsIncumbents: false,
    });
  });

  test('前置き・コードフェンス混じりでも抽出する', () => {
    const v = parseQdVerdict(
      '判定:\n```json\n{"novelty":"duplicate","duplicateOfId":12,"cell":"x/y/z","beatsIncumbents":false}\n```',
    );
    expect(v?.novelty).toBe('duplicate');
    expect(v?.duplicateOfId).toBe(12);
  });

  test('壊れJSON・novelty欠落は null（フェイルオープン用）', () => {
    expect(parseQdVerdict('JSONじゃない')).toBeNull();
    expect(parseQdVerdict('{"cell":"a/b/c"}')).toBeNull();
    expect(parseQdVerdict(null)).toBeNull();
  });
});

describe('decideQdAcceptance', () => {
  const newVerdict = (cell: string | null, beats: boolean) => ({
    novelty: 'new' as const,
    duplicateOfId: null,
    cell,
    beatsIncumbents: beats,
  });

  test('duplicate は不受理で duplicateOfId を返す（近傍に実在するidのみ信用）', () => {
    const d = decideQdAcceptance(
      { novelty: 'duplicate', duplicateOfId: 7, cell: null, beatsIncumbents: false },
      0,
      [neighbor(7, 'A')],
    );
    expect(d.accept).toBe(false);
    expect(d.duplicateOfId).toBe(7);
  });

  test('duplicateOfId が近傍に無い捏造idなら先頭近傍にフォールバック', () => {
    const d = decideQdAcceptance(
      { novelty: 'duplicate', duplicateOfId: 999, cell: null, beatsIncumbents: false },
      0,
      [neighbor(3, 'A'), neighbor(4, 'B')],
    );
    expect(d.duplicateOfId).toBe(3);
  });

  test('空セルへの new は受理', () => {
    const d = decideQdAcceptance(newVerdict('ui/改善/開発者', false), 0, [neighbor(1, 'A')]);
    expect(d.accept).toBe(true);
    expect(d.cell).toBe('ui/改善/開発者');
  });

  test('占有セル(cap以上)で勝てなければ不受理', () => {
    const d = decideQdAcceptance(newVerdict('ui/改善/開発者', false), 2, [
      neighbor(5, 'A', 'ui/改善/開発者'),
    ]);
    expect(d.accept).toBe(false);
    expect(d.duplicateOfId).toBe(5);
  });

  test('占有セルでも勝ち抜きなら受理', () => {
    const d = decideQdAcceptance(newVerdict('ui/改善/開発者', true), 2, [
      neighbor(5, 'A', 'ui/改善/開発者'),
    ]);
    expect(d.accept).toBe(true);
  });
});

describe('parseCellTag', () => {
  test('cell: タグを抽出する', () => {
    expect(parseCellTag(JSON.stringify(['scope:project', 'cell:ui/改善/開発者']))).toBe(
      'ui/改善/開発者',
    );
  });
  test('無ければ null、壊れたJSONも null', () => {
    expect(parseCellTag(JSON.stringify(['scope:project']))).toBeNull();
    expect(parseCellTag('not-json')).toBeNull();
    expect(parseCellTag(null)).toBeNull();
  });
});

describe('evaluateIdeaQd — フェイルオープン', () => {
  test('近傍ゼロなら judged:false で受理', async () => {
    mockFindMany.mockResolvedValueOnce([]);
    const r = await evaluateIdeaQd({ title: 't', content: 'c', themeId: 1 });
    expect(r.accept).toBe(true);
    expect(r.judged).toBe(false);
  });

  test('ジャッジが壊れた応答を返しても受理（フェイルオープン）', async () => {
    mockFindMany.mockResolvedValueOnce([{ id: 1, title: '既存', content: 'c', tags: '[]' }]);
    mockSendAIMessage.mockResolvedValueOnce({ content: 'ぐちゃぐちゃ', tokensUsed: 5 });
    const r = await evaluateIdeaQd({ title: 't', content: 'c', themeId: 1 });
    expect(r.accept).toBe(true);
    expect(r.judged).toBe(false);
  });

  test('ジャッジが例外でも受理（フェイルオープン）', async () => {
    mockFindMany.mockResolvedValueOnce([{ id: 1, title: '既存', content: 'c', tags: '[]' }]);
    mockSendAIMessage.mockRejectedValueOnce(new Error('CLI down'));
    const r = await evaluateIdeaQd({ title: 't', content: 'c', themeId: 1 });
    expect(r.accept).toBe(true);
    expect(r.judged).toBe(false);
  });

  test('RAPITAS_QD_IDEA_GATE=off で完全スキップ', async () => {
    process.env.RAPITAS_QD_IDEA_GATE = 'off';
    try {
      const r = await evaluateIdeaQd({ title: 't', content: 'c', themeId: 1 });
      expect(r.accept).toBe(true);
      expect(r.judged).toBe(false);
    } finally {
      delete process.env.RAPITAS_QD_IDEA_GATE;
    }
  });
});
