/**
 * workflow-auto-commit-reuse-push テスト
 *
 * 既存 PR を再利用する経路で、作業ブランチが必ず origin へ push されること、
 * および push 失敗が成功に化けないことを検証する(#10694: ci_repair の修正が
 * ローカルコミットのまま PR に届かなかった)。
 */
import { describe, expect, test, mock } from 'bun:test';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const { pushExistingPrBranch } = await import('./workflow-auto-commit-reuse-push');

describe('pushExistingPrBranch', () => {
  test('pushes the given branch to origin from the given cwd', async () => {
    const calls: Array<{ args: string[]; cwd: string }> = [];
    const run = (args: string[], opts: { cwd: string }) => {
      calls.push({ args, cwd: opts.cwd });
      return Promise.resolve({});
    };
    const out = await pushExistingPrBranch('C:\\wt\\task-1002', 'bugfix/t1002-update-task', run);
    expect(out).toEqual({ success: true });
    expect(calls).toEqual([
      { args: ['push', 'origin', 'bugfix/t1002-update-task'], cwd: 'C:\\wt\\task-1002' },
    ]);
  });

  test('a rejected push is reported as failure with the git message, never as success', async () => {
    const run = () => Promise.reject(new Error('! [rejected] non-fast-forward'));
    const out = await pushExistingPrBranch('C:\\wt\\task-1002', 'bugfix/t1002-update-task', run);
    expect(out.success).toBe(false);
    expect(out.error).toContain('non-fast-forward');
  });
});
