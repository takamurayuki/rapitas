/**
 * fail-closed-count テスト
 *
 * countWithFailClosed が「カウントクエリ失敗時にゼロを返す（fail-open）」のではなく、
 * 上限値（cap）を返す（fail-closed）ことを検証する。cap を返すことで呼び出し側の
 * `count >= cap` 判定が常に真になり、DB エラー時にループ/リトライが停止する。
 */
import { describe, test, expect, mock } from 'bun:test';
import { countWithFailClosed } from './fail-closed-count';

describe('countWithFailClosed', () => {
  test('成功時は実際のカウントをそのまま返すこと', async () => {
    const result = await countWithFailClosed(
      Promise.resolve(3),
      10,
      { warn: mock(() => {}) },
      { taskId: 1 },
      'test-counter',
    );
    expect(result).toBe(3);
  });

  test('FAIL CLOSED: カウントクエリが reject した場合、0 ではなく cap を返すこと', async () => {
    const result = await countWithFailClosed(
      Promise.reject(new Error('connection reset')),
      5,
      { warn: mock(() => {}) },
      { taskId: 1 },
      'test-counter',
    );
    expect(result).toBe(5);
    expect(result).not.toBe(0);
  });

  test('失敗時、count >= cap 判定が真になる（呼び出し側のループ/リトライが停止する）こと', async () => {
    const cap = 3;
    const result = await countWithFailClosed(
      Promise.reject(new Error('timeout')),
      cap,
      { warn: mock(() => {}) },
      {},
      'test-counter',
    );
    expect(result >= cap).toBe(true);
  });

  test('失敗時、cap とラベル・コンテキストを含めて warn ログを出すこと', async () => {
    const warn = mock(() => {});
    await countWithFailClosed(
      Promise.reject(new Error('boom')),
      7,
      { warn },
      { taskId: 42 },
      'my-counter',
    );
    expect(warn).toHaveBeenCalledTimes(1);
    const [ctx, msg] = warn.mock.calls[0] as [Record<string, unknown>, string];
    expect(ctx).toMatchObject({ taskId: 42, cap: 7 });
    expect(ctx.err).toBeInstanceOf(Error);
    expect(msg).toContain('my-counter');
    expect(msg).toContain('exhausted');
  });

  test('成功時は warn ログを出さないこと', async () => {
    const warn = mock(() => {});
    await countWithFailClosed(Promise.resolve(0), 5, { warn }, {}, 'test-counter');
    expect(warn).not.toHaveBeenCalled();
  });
});
