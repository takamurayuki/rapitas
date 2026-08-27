/**
 * conflict-resolver ユニットテスト
 *
 * merge --abort が best-effort なクリーンアップであり、その結果を呼び出し側が
 * 一切参照しないケースで ERROR ログが抑制される（skipLog: true が渡る）ことを
 * 検証する（回帰テスト: github-service:git-exec の無意味な ERROR 起票対策）。
 */
import { describe, expect, it, mock } from 'bun:test';

type GitCall = { args: string[]; opts?: { skipLog?: boolean } };

let calls: GitCall[] = [];
let failMerge = false;

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

mock.module('./git-exec', () => ({
  runGitCommand: (args: string[], _cwd?: string, opts?: { skipLog?: boolean }) => {
    calls.push({ args, opts });
    if (args.includes('merge') && !args.includes('--abort') && failMerge) {
      return Promise.reject(new Error('CONFLICT (content)'));
    }
    if (args.includes('diff') && args.includes('--diff-filter=U')) {
      return Promise.resolve('src/conflicted.ts');
    }
    return Promise.resolve('');
  },
}));

const { resolvePrConflicts } = await import('./conflict-resolver');

describe('resolvePrConflicts', () => {
  it('merge conflict → merge --abort is called with skipLog: true', async () => {
    calls = [];
    failMerge = true;

    const result = await resolvePrConflicts('/workspace', 'develop', 'feature/x');

    expect(result.resolved).toBe(false);
    expect(result.conflicts).toEqual(['src/conflicted.ts']);
    const abortCall = calls.find((c) => c.args.includes('merge') && c.args.includes('--abort'));
    expect(abortCall).toBeDefined();
    expect(abortCall?.opts?.skipLog).toBe(true);
  });

  it('clean merge → merge --abort is never called', async () => {
    calls = [];
    failMerge = false;

    const result = await resolvePrConflicts('/workspace', 'develop', 'feature/x');

    expect(result.resolved).toBe(true);
    expect(calls.some((c) => c.args.includes('merge') && c.args.includes('--abort'))).toBe(false);
  });
});
