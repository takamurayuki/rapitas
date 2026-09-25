/**
 * pr-draft-ops テスト
 *
 * readyPullRequest が `gh pr ready <prNumber>` を正しい引数で呼ぶこと、
 * 失敗しても例外を投げず false を返すこと (task 1099) を検証する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

let calls: Array<{ file: string; args: string[]; cwd?: string }> = [];
let shouldFail = false;

mock.module('child_process', () => ({
  execFile: (
    file: string,
    args: unknown,
    opts: unknown,
    cb?: (e: Error | null, r?: unknown) => void,
  ) => {
    const argv = Array.isArray(args) ? (args as string[]) : [];
    const callback = (typeof opts === 'function' ? opts : cb) as (
      e: Error | null,
      r?: unknown,
    ) => void;
    const o = typeof opts === 'function' ? undefined : (opts as { cwd?: string });
    calls.push({ file, args: argv, cwd: o?.cwd });
    if (shouldFail) callback(new Error('gh: not found'));
    else callback(null, { stdout: '', stderr: '' });
  },
}));
mock.module('node:child_process', () => ({
  execFile: (
    file: string,
    args: unknown,
    opts: unknown,
    cb?: (e: Error | null, r?: unknown) => void,
  ) => {
    const argv = Array.isArray(args) ? (args as string[]) : [];
    const callback = (typeof opts === 'function' ? opts : cb) as (
      e: Error | null,
      r?: unknown,
    ) => void;
    const o = typeof opts === 'function' ? undefined : (opts as { cwd?: string });
    calls.push({ file, args: argv, cwd: o?.cwd });
    if (shouldFail) callback(new Error('gh: not found'));
    else callback(null, { stdout: '', stderr: '' });
  },
}));
mock.module('../../../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

const { readyPullRequest } = await import('./pr-draft-ops');

beforeEach(() => {
  calls = [];
  shouldFail = false;
});

describe('readyPullRequest', () => {
  test('gh pr ready <prNumber> を対象の cwd で実行し true を返すこと', async () => {
    const ok = await readyPullRequest('/repo', 42);
    expect(ok).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0]!.args).toEqual(['pr', 'ready', '42']);
    expect(calls[0]!.cwd).toBe('/repo');
  });

  test('gh の失敗時は例外を投げず false を返すこと', async () => {
    shouldFail = true;
    const ok = await readyPullRequest('/repo', 42);
    expect(ok).toBe(false);
  });
});
