/**
 * idea-box theme-saturation gate ユニットテスト
 *
 * submitIdea の「自己強化モノカルチャー遮断（字句ベースのテーマ飽和ガード）」を検証:
 *  - 既存open ideaと4文字以上の共通部分文字列を SATURATION_CAP 件以上共有 → 拒否
 *  - 新規テーマ（共通部分文字列なし）→ 作成
 */
import { describe, expect, mock, test } from 'bun:test';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

// 既存 open ideas を差し替え可能に
let openIdeas: Array<{ id: number; title: string }> = [];
let created = 0;
mock.module('../../config/database', () => ({
  prisma: {
    knowledgeEntry: {
      findFirst: () => Promise.resolve(null), // no exact-hash dup
      findMany: () => Promise.resolve(openIdeas), // saturation gate source
      create: () => {
        created += 1;
        return Promise.resolve({ id: 500 });
      },
    },
    theme: {
      findMany: () => Promise.resolve([{ id: 1, isDefault: true, workingDirectory: '/w' }]),
    },
  },
}));

const { submitIdea } = await import('./idea-box-service');

describe('submitIdea — theme-saturation gate (anti-monoculture)', () => {
  test('同テーマが飽和(9件で「型ガード関数」共有)なら拒否し新規作成しない', async () => {
    created = 0;
    const suffixes = ['標準化', '汎用化', '自動生成', '中央集約', 'SSOT化', 'テンプレート化', '再利用', 'ライブラリ化', '横展開'];
    openIdeas = suffixes.map((s, i) => ({ id: 100 + i, title: `型ガード関数の${s}` }));
    const id = await submitIdea({
      title: '型ガード関数の一括リファクタリング',
      content: 'また型ガードの話',
    });
    expect(id).toBe(100); // anchor id of an existing saturated-theme idea
    expect(created).toBe(0);
  });

  test('新規テーマ（共通部分文字列なし）は作成される', async () => {
    created = 0;
    openIdeas = Array.from({ length: 9 }, (_, i) => ({ id: 100 + i, title: `型ガード関数の項目${i}` }));
    const id = await submitIdea({
      title: 'freeeレシートOCRの自動仕訳プレビュー',
      content: '全く別ドメインの新規提案',
    });
    expect(id).toBe(500);
    expect(created).toBe(1);
  });

  test('同テーマでも件数が少なければ(CAP未満)作成される', async () => {
    created = 0;
    openIdeas = [
      { id: 100, title: '型ガード関数の標準化' },
      { id: 101, title: '型ガード関数の汎用化' },
    ];
    const id = await submitIdea({ title: '型ガード関数の自動生成', content: 'まだ少数の型ガード提案' });
    expect(id).toBe(500); // only 2 < CAP(8) → admitted
    expect(created).toBe(1);
  });
});
