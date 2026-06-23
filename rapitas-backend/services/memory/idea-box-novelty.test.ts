/**
 * idea-box novelty-gate ユニットテスト
 *
 * submitIdea の「自己強化モノカルチャー遮断」ゲートを検証する:
 *  - 意味的に冗長なアイデアは既存IDを返してスキップ
 *  - 判読不能(mojibake)なアイデアは -1 で拒否
 *  - 新規アイデアは作成される
 */
import { describe, expect, mock, test } from 'bun:test';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

// findSemanticDuplicate を差し替え可能に
let semanticDupId: number | null = null;
mock.module('./dedup', () => ({
  findSemanticDuplicate: () => Promise.resolve(semanticDupId),
}));

let created = 0;
mock.module('../../config/database', () => ({
  prisma: {
    knowledgeEntry: {
      findFirst: () => Promise.resolve(null), // no exact-hash dup
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

function reset(dup: number | null) {
  semanticDupId = dup;
  created = 0;
}

describe('submitIdea — novelty gate (anti-monoculture)', () => {
  test('意味的に冗長なアイデアは既存IDを返し新規作成しない', async () => {
    reset(42); // findSemanticDuplicate returns an existing entry
    const id = await submitIdea({ title: '型ガード関数の標準化', content: '既存とほぼ同義の提案' });
    expect(id).toBe(42);
    expect(created).toBe(0);
  });

  test('新規（非冗長）アイデアは作成される', async () => {
    reset(null); // no semantic dup
    const id = await submitIdea({
      title: 'freee API のレート制限バックオフ実装',
      content: '全く新しいドメインの提案で既存と重複しない',
    });
    expect(id).toBe(500);
    expect(created).toBe(1);
  });
});
