/**
 * cli-availability ユニットテスト
 *
 * getAgentCliContext のPATH検出結果に応じたプロンプト生成、5分キャッシュ、
 * invalidateAgentCliCache によるキャッシュ破棄を検証する。
 * child_process.exec をモックし実PATHには依存しない。
 *
 * NOTE: util.promisify(exec) はコールバックが単一のオブジェクト引数
 * (err, { stdout, stderr }) で呼ばれた場合、そのままそのオブジェクトで
 * resolve する — worktree-ops.test.ts と同じ手法。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

let onPathCommands: Set<string>;

const mockExec = mock(
  (
    command: string,
    _options: unknown,
    callback: (err: Error | null, result?: { stdout: string; stderr: string }) => void,
  ) => {
    const cmd = command.replace(/^where |^command -v /, '').trim();
    if (onPathCommands.has(cmd)) {
      callback(null, { stdout: `/usr/bin/${cmd}\n`, stderr: '' });
    } else {
      callback(new Error(`not found: ${cmd}`));
    }
  },
);

mock.module('child_process', () => ({
  exec: mockExec,
}));

const { getAgentCliContext, invalidateAgentCliCache } = await import('./cli-availability');

describe('getAgentCliContext', () => {
  beforeEach(() => {
    onPathCommands = new Set();
    invalidateAgentCliCache();
    mockExec.mockClear();
  });

  test('returns an empty string when no agent CLI is installed', async () => {
    const result = await getAgentCliContext();
    expect(result).toBe('');
  });

  test('lists installed CLIs with their hints', async () => {
    onPathCommands = new Set(['rg', 'gh']);
    const result = await getAgentCliContext();
    expect(result).toContain('## 利用可能な CLI ツール');
    expect(result).toContain('`rg`');
    expect(result).toContain('`gh`');
    expect(result).not.toContain('`fd`');
  });

  test('caches the result and does not re-probe PATH on a second call', async () => {
    onPathCommands = new Set(['jq']);
    const first = await getAgentCliContext();
    const callsAfterFirst = mockExec.mock.calls.length;

    onPathCommands = new Set(); // if it re-probed, this would flip the result to ''
    const second = await getAgentCliContext();

    expect(second).toBe(first);
    expect(mockExec.mock.calls.length).toBe(callsAfterFirst);
  });

  test('invalidateAgentCliCache forces a fresh PATH probe', async () => {
    onPathCommands = new Set(['jq']);
    const first = await getAgentCliContext();
    expect(first).toContain('`jq`');

    invalidateAgentCliCache();
    onPathCommands = new Set();
    const second = await getAgentCliContext();

    expect(second).toBe('');
  });
});
