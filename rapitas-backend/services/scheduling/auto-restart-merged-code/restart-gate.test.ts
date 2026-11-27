/**
 * restart-gate.test
 *
 * The contract of the restart gate (task 1562): sections never overlap, a
 * failing section releases the gate, and a nested acquisition is an error
 * rather than a deadlock.
 */
import { describe, test, expect } from 'bun:test';
import { withRestartGate } from './restart-gate';

describe('restart gate', () => {
  test('区間が終了した後の非同期継続は入れ子と判定しない', async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { continuation } = await withRestartGate(async () => ({
      continuation: hold.then(() => withRestartGate(async () => '再取得')),
    }));
    release();
    expect(await continuation).toBe('再取得');
  });
  test('sections never overlap and a throwing section does not wedge the gate', async () => {
    const order: string[] = [];
    const a = withRestartGate(async () => {
      order.push('a:start');
      await new Promise((r) => setTimeout(r, 15));
      order.push('a:end');
      throw new Error('boom');
    });
    const b = withRestartGate(async () => {
      order.push('b');
      return 'ok';
    });
    await expect(a).rejects.toThrow('boom');
    expect(await b).toBe('ok');
    expect(order).toEqual(['a:start', 'a:end', 'b']);
  });

  test('a nested acquisition is an error instead of a deadlock', async () => {
    const outcome = await withRestartGate(async () =>
      withRestartGate(async () => 'never').then(
        () => 'resolved',
        (err: Error) => err.message,
      ),
    );
    expect(outcome).toContain('nested');
    // The outer section released normally.
    expect(await withRestartGate(async () => 'after')).toBe('after');
  });
});
