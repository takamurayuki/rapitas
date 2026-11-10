/**
 * executor-model テスト
 *
 * 実行役（implementer）のモデルを実行記録から求めるとき、変更に寄与した可能性の
 * ある実行のうち 1 件でもモデル不明なら、既知の実行があっても未確認（premium 前
 * 提）にすることを固定する（G2 routing1 再レビュー指摘3）。
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }),
}));

let runs: { modelName: string | null }[] = [];
let lastQuery: { where?: Record<string, unknown>; take?: number } | null = null;
let dbDown = false;
mock.module('../../../config/database', () => ({
  prisma: {
    agentExecution: {
      findMany: async (q: { where?: Record<string, unknown>; take?: number }) => {
        lastQuery = q;
        if (dbDown) throw new Error('db down');
        return runs;
      },
    },
  },
}));

const { resolveExecutor } = await import('./executor-model');

beforeEach(() => {
  runs = [];
  lastQuery = null;
  dbDown = false;
});

describe('resolveExecutor', () => {
  test('既知の実行だけなら、その中で最も強いティア', async () => {
    runs = [{ modelName: 'claude-sonnet-5-5' }, { modelName: 'claude-opus-5-5' }];
    const ex = await resolveExecutor(1);
    expect(ex.verified).toBe(true);
    expect(ex.tier).toBe('premium');
    expect(ex.modelId).toBe('claude-opus-5-5');
  });

  test('Sonnet の実行＋モデル不明の修復実行は、未確認（premium 前提）になる', async () => {
    runs = [{ modelName: null }, { modelName: 'claude-sonnet-5-5' }];
    const ex = await resolveExecutor(1);
    expect(ex.verified).toBe(false);
    expect(ex.tier).toBe('premium');
  });

  test('空文字のモデル名も不明として扱う', async () => {
    runs = [{ modelName: 'claude-sonnet-5-5' }, { modelName: '  ' }];
    expect((await resolveExecutor(1)).verified).toBe(false);
  });

  test('モデル不明の実行を検索で除外しない（modelName で絞り込まない）', async () => {
    runs = [{ modelName: 'claude-sonnet-5-5' }];
    await resolveExecutor(1);
    expect(lastQuery?.where && 'modelName' in lastQuery.where).toBe(false);
  });

  test('件数の上限で古い実行を切り捨てない', async () => {
    runs = [{ modelName: 'claude-sonnet-5-5' }];
    await resolveExecutor(1);
    expect(lastQuery?.take).toBeUndefined();
  });

  test('実行がない／読めないときは未確認', async () => {
    expect((await resolveExecutor(1)).verified).toBe(false);
    dbDown = true;
    expect((await resolveExecutor(1)).verified).toBe(false);
  });
});
