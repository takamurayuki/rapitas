/**
 * theme-saturation ユニットテスト
 *
 * lcsLen と findSaturatedTheme（idea/concern 共通の anti-monoculture ゲート）を検証。
 */
import { describe, expect, mock, test } from 'bun:test';

let pool: Array<{ id: number; title: string }> = [];
let lastWhere: Record<string, unknown> | null = null;
mock.module('../../config/database', () => ({
  prisma: {
    knowledgeEntry: {
      findMany: ({ where }: { where: Record<string, unknown> }) => {
        lastWhere = where;
        return Promise.resolve(pool);
      },
    },
  },
}));

const { lcsLen, findSaturatedTheme, charBigrams, bigramJaccard, findNearDuplicate } =
  await import('./theme-saturation');

describe('lcsLen', () => {
  test('共通部分文字列の最長長を返す', () => {
    expect(
      lcsLen('gen:type-guards の Prettier 同期', 'gen:type-guards が Prettier 非互換'),
    ).toBeGreaterThanOrEqual(8);
    expect(lcsLen('freee OCR 仕訳', '通知音の設定')).toBeLessThan(4);
  });
});

describe('bigramJaccard / charBigrams', () => {
  test('正規化で空白・区切りを無視する', () => {
    expect([...charBigrams('a b-c')]).toEqual(['ab', 'bc']);
  });
  test('同一タイトルは 1.0', () => {
    expect(bigramJaccard('型ガード生成のCI組み込み', '型ガード生成のCI組み込み')).toBe(1);
  });
  test('カタカナ揺れのクローンは高スコア（≥0.45）', () => {
    // The exact near-clone the extractor keeps re-filing — caught at 0.45.
    const s = bigramJaccard(
      'コマンド型ゲートの実体取り込み（SSOT/型ガード/クリティカルガード）',
      'コマンド型ゲートの実装（SSOT/型ガード/クリティカルガード）',
    );
    expect(s).toBeGreaterThanOrEqual(0.45);
  });
  test('同一テーマの別ファセットは低スコア（<0.45・過剰拒否しない）', () => {
    const s = bigramJaccard(
      'Jaccard閾値の動的調整・学習機構',
      'ドキュメント構造ガイドの自動生成・保守',
    );
    expect(s).toBeLessThan(0.45);
  });
  test('空文字は 0', () => {
    expect(bigramJaccard('', 'abc')).toBe(0);
  });
});

describe('findNearDuplicate', () => {
  test('閾値以上の近重複が存在 → その id を返す', async () => {
    pool = [
      { id: 21, title: 'ゲート登録APIの宣言的・汎用フレームワーク化' },
      { id: 22, title: 'コマンド型ゲートの実体取り込み（SSOT/型ガード/クリティカルガード）' },
    ];
    const r = await findNearDuplicate(
      'コマンド型ゲートの実装（SSOT/型ガード/クリティカルガード）',
      { sourceType: 'idea_box' },
      0.45,
    );
    expect(r).toBe(22);
  });
  test('近重複が無ければ null（別ファセットは通す）', async () => {
    pool = [
      { id: 31, title: 'Jaccard閾値の動的調整・学習機構' },
      { id: 32, title: 'docs/ 健全性ゲートを ci-gates.ts に組み込み定期検証化' },
    ];
    const r = await findNearDuplicate(
      'ドキュメント構造ガイドの自動生成・保守',
      { sourceType: 'idea_box' },
      0.45,
    );
    expect(r).toBeNull();
  });
});

describe('findSaturatedTheme', () => {
  test('CAP件以上が salient 部分文字列を共有 → anchor id を返す（飽和）', async () => {
    pool = Array.from({ length: 3 }, (_, i) => ({
      id: 10 + i,
      title: `gen:type-guards の Prettier 整形 ${i}`,
    }));
    const r = await findSaturatedTheme('gen:type-guards の Prettier 同期メカニズム', {
      sourceType: 'concern',
      cap: 3,
      salient: 8,
      openConcernOnly: true,
    });
    expect(r).toBe(10);
    expect(lastWhere).toEqual({ sourceType: 'concern', sourceId: 'open' });
  });

  test('新規テーマ（共有なし）→ null（許可）', async () => {
    pool = Array.from({ length: 5 }, (_, i) => ({ id: 10 + i, title: `gen:type-guards ${i}` }));
    const r = await findSaturatedTheme('freeeレシートOCRの自動仕訳プレビュー機能', {
      sourceType: 'idea_box',
      cap: 8,
      salient: 4,
    });
    expect(r).toBeNull();
  });

  test('CAP未満なら許可', async () => {
    pool = [
      { id: 10, title: 'gen:type-guards の Prettier 整形 A' },
      { id: 11, title: 'gen:type-guards の Prettier 整形 B' },
    ];
    const r = await findSaturatedTheme('gen:type-guards の Prettier 同期', {
      sourceType: 'concern',
      cap: 3,
      salient: 8,
    });
    expect(r).toBeNull(); // only 2 < cap 3
  });
});
