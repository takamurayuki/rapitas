/**
 * branch-pr-ops テスト
 *
 * createPullRequest の push 堅牢化を検証: origin のブランチが分岐している
 * (過去実行の `feature/implement-task` 等と衝突) 場合に、force-push せず
 * コミット一意のブランチへ push し直して PR 作成まで到達すること。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Scripted exec: maps a matched command substring → stdout, or throws when the
// value is an Error. Records every issued command for assertions.
let calls: string[] = [];
let script: Array<{ match: RegExp; result: string | Error }> = [];

function runScripted(cmd: string): { stdout: string; stderr: string } {
  calls.push(cmd);
  for (const s of script) {
    if (s.match.test(cmd)) {
      if (s.result instanceof Error) throw s.result;
      return { stdout: s.result, stderr: '' };
    }
  }
  return { stdout: '', stderr: '' };
}

mock.module('child_process', () => ({
  // promisify(exec) calls exec(cmd, options, callback); resolve {stdout,stderr}.
  exec: (cmd: string, _opts: unknown, cb?: (e: Error | null, r?: unknown) => void) => {
    const callback = (typeof _opts === 'function' ? _opts : cb) as (
      e: Error | null,
      r?: unknown,
    ) => void;
    try {
      callback(null, runScripted(cmd));
    } catch (err) {
      callback(err as Error);
    }
  },
}));
mock.module('../../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

const { createPullRequest } = await import('./branch-pr-ops');

const rejected = () =>
  new Error(
    'Command failed: git push -u origin feature/implement-task\n ! [rejected] feature/implement-task -> feature/implement-task (non-fast-forward)',
  );

beforeEach(() => {
  calls = [];
  script = [];
});

describe('createPullRequest — push 分岐耐性', () => {
  test('origin が分岐していたらコミット一意ブランチへ push し直して PR 作成すること', async () => {
    script = [
      { match: /git branch --list develop/, result: 'develop\n' },
      { match: /git branch --show-current/, result: 'feature/implement-task\n' },
      { match: /git push -u origin feature\/implement-task$/, result: rejected() },
      { match: /git rev-parse --short HEAD/, result: 'abc1234\n' },
      { match: /git branch -M feature\/implement-task-abc1234/, result: '' },
      { match: /git push -u origin feature\/implement-task-abc1234$/, result: '' },
      { match: /pr list --head/, result: '' },
      { match: /pr create/, result: 'https://github.com/x/y/pull/42\n' },
    ];

    const res = await createPullRequest('/repo', 'タイトル', '本文');

    expect(res.success).toBe(true);
    expect(res.prNumber).toBe(42);
    // 一意ブランチへリネームして push したこと（force-push していないこと）
    expect(calls.some((c) => /git branch -M feature\/implement-task-abc1234/.test(c))).toBe(true);
    expect(calls.some((c) => /git push -u origin feature\/implement-task-abc1234$/.test(c))).toBe(
      true,
    );
    expect(calls.some((c) => /--force/.test(c))).toBe(false);
    // PR は一意ブランチ head で探索されること
    expect(calls.some((c) => /pr list --head feature\/implement-task-abc1234/.test(c))).toBe(true);
  });

  test('push が成功すれば元のブランチのまま PR 作成すること', async () => {
    script = [
      { match: /git branch --list develop/, result: 'develop\n' },
      { match: /git branch --show-current/, result: 'feature/add-foo\n' },
      { match: /git push -u origin feature\/add-foo$/, result: '' },
      { match: /pr list --head/, result: '' },
      { match: /pr create/, result: 'https://github.com/x/y/pull/7\n' },
    ];

    const res = await createPullRequest('/repo', 't', 'b');

    expect(res.success).toBe(true);
    expect(res.prNumber).toBe(7);
    expect(calls.some((c) => /git branch -M/.test(c))).toBe(false); // リネームしない
  });

  test('分岐以外の push 失敗 (認証等) は PR 失敗として返すこと', async () => {
    script = [
      { match: /git branch --list develop/, result: 'develop\n' },
      { match: /git branch --show-current/, result: 'feature/add-foo\n' },
      {
        match: /git push -u origin feature\/add-foo$/,
        result: new Error('fatal: Authentication failed'),
      },
    ];

    const res = await createPullRequest('/repo', 't', 'b');

    expect(res.success).toBe(false);
    expect(res.error).toContain('Authentication failed');
    expect(calls.some((c) => /git branch -M/.test(c))).toBe(false);
  });
});
