/**
 * reset-mocks.test.ts
 *
 * resetDeepMocks ユーティリティのユニットテスト。
 */
import { describe, test, expect, mock } from 'bun:test';
import { resetDeepMocks } from './reset-mocks';

// ---------------------------------------------------------------------------
// テスト用 mock ヘルパー
// ---------------------------------------------------------------------------

function makeMock() {
  return mock(() => Promise.resolve('default'));
}

// ---------------------------------------------------------------------------
// 基本動作テスト
// ---------------------------------------------------------------------------

describe('resetDeepMocks', () => {
  test('トップレベル mock 関数をリセットすること', () => {
    const fn = makeMock();
    fn.mockReturnValue(Promise.resolve('overridden'));
    fn(); // call count を増やす

    resetDeepMocks({ fn });

    expect(fn.mock.calls.length).toBe(0);
  });

  test('ネストした mock 関数をリセットすること', () => {
    const deepFn = makeMock();
    deepFn();
    deepFn();

    const root = { level1: { level2: { deepFn } } };
    resetDeepMocks(root);

    expect(deepFn.mock.calls.length).toBe(0);
  });

  test('複数モデルを持つ prisma 風オブジェクトを全リセットすること', () => {
    const findMany = makeMock();
    const create = makeMock();
    const transaction = mock((fn: (tx: unknown) => unknown) => fn({}));

    findMany();
    create();
    transaction(() => {});

    const root = {
      task: { findMany, create },
      $transaction: transaction,
    };

    resetDeepMocks(root);

    expect(findMany.mock.calls.length).toBe(0);
    expect(create.mock.calls.length).toBe(0);
    expect(transaction.mock.calls.length).toBe(0);
  });

  test('非 mock 関数はスキップされること（throw しない）', () => {
    const normalFn = () => 42;
    const root = { normalFn, value: 'string', count: 0 };
    expect(() => resetDeepMocks(root)).not.toThrow();
  });

  test('非関数値はスキップされること', () => {
    const root = { str: 'hello', num: 42, bool: true, arr: [1, 2, 3] };
    expect(() => resetDeepMocks(root)).not.toThrow();
  });

  test('null / undefined の値を含むオブジェクトで throw しないこと', () => {
    const root = { a: null, b: undefined, c: makeMock() };
    expect(() => resetDeepMocks(root)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// afterReset コールバックテスト
// ---------------------------------------------------------------------------

describe('resetDeepMocks with afterReset', () => {
  test('afterReset が最後に呼ばれること', () => {
    const fn = makeMock();
    fn();
    const afterResetMock = mock(() => {});

    resetDeepMocks({ fn }, { afterReset: afterResetMock });

    expect(fn.mock.calls.length).toBe(0);
    expect(afterResetMock).toHaveBeenCalledTimes(1);
  });

  test('$transaction の既定実装を afterReset で復元できること', () => {
    const mockPrisma = {
      task: { findMany: makeMock() },
      $transaction: mock((fn: (tx: unknown) => unknown) => fn(mockPrisma)),
    };
    mockPrisma.task.findMany();

    resetDeepMocks(mockPrisma, {
      afterReset: () => {
        mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
          fn(mockPrisma),
        );
      },
    });

    // $transaction の呼び出し回数はリセットされている
    expect(mockPrisma.$transaction.mock.calls.length).toBe(0);
    // 既定実装が復元されているため、呼び出すとコールバックを実行する
    let received: unknown;
    mockPrisma.$transaction((tx: unknown) => {
      received = tx;
    });
    expect(received).toBe(mockPrisma);
  });
});

// ---------------------------------------------------------------------------
// エッジケーステスト
// ---------------------------------------------------------------------------

describe('resetDeepMocks エッジケース', () => {
  test('空オブジェクトで throw しないこと', () => {
    expect(() => resetDeepMocks({})).not.toThrow();
  });

  test('null を渡しても throw しないこと', () => {
    expect(() => resetDeepMocks(null)).not.toThrow();
  });

  test('undefined を渡しても throw しないこと', () => {
    expect(() => resetDeepMocks(undefined)).not.toThrow();
  });

  test('maxDepth オプションが機能すること', () => {
    const fn = makeMock();
    fn();
    // depth 2 に配置するが maxDepth=1 で到達しない
    const root = { level1: { level2: { fn } } };
    resetDeepMocks(root, { maxDepth: 1 });
    // maxDepth=1 では level2 に到達しないため fn はリセットされない
    expect(fn.mock.calls.length).toBe(1);
  });

  test('循環参照で無限ループしないこと', () => {
    const fn = makeMock();
    fn();
    const root: Record<string, unknown> = { fn };
    root.self = root; // 循環参照
    expect(() => resetDeepMocks(root)).not.toThrow();
    expect(fn.mock.calls.length).toBe(0);
  });
});
