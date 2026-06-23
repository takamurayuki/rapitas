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

const { lcsLen, findSaturatedTheme } = await import('./theme-saturation');

describe('lcsLen', () => {
  test('共通部分文字列の最長長を返す', () => {
    expect(
      lcsLen('gen:type-guards の Prettier 同期', 'gen:type-guards が Prettier 非互換'),
    ).toBeGreaterThanOrEqual(8);
    expect(lcsLen('freee OCR 仕訳', '通知音の設定')).toBeLessThan(4);
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
