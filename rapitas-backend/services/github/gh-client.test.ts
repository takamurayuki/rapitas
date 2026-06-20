/**
 * gh-client.test
 *
 * Tests for runGhCommandWithBody:
 * - Routes body via UTF-8 temp file with --body-file flag
 * - Unconditionally removes temp file on success and failure (finally guarantee)
 * - Handles undefined body (no file created, no --body-file)
 * - Handles empty string body
 * - Warns (not throws) on unlink failure
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Mutable state shared with the execFile mock closure so we can change
// behavior per test without calling mockImplementationOnce.
let capturedArgs: string[] = [];
let shouldGhFail = false;
let ghStdout = '';

const mockExecFile = mock(
  (
    _bin: string,
    args: string[],
    _opts: object,
    cb: (err: Error | null, result?: { stdout: string; stderr: string }) => void,
  ) => {
    capturedArgs = [...args];
    if (shouldGhFail) {
      const err = Object.assign(new Error('gh: command failed'), { stderr: 'mock stderr' });
      cb(err);
    } else {
      cb(null, { stdout: ghStdout, stderr: '' });
    }
  },
);

const mockWriteFile = mock(() => Promise.resolve());
const mockUnlink = mock(() => Promise.resolve());
const mockWarn = mock(() => {});

// NOTE: Include exec as well to prevent "export not found" when pr-write.test.ts
// runs in the same process (bun mock.module is process-global).
mock.module('child_process', () => ({ execFile: mockExecFile, exec: mock(() => {}) }));
mock.module('fs/promises', () => ({ writeFile: mockWriteFile, unlink: mockUnlink }));
mock.module('../../config/logger', () => ({
  createLogger: () => ({
    info: mock(() => {}),
    debug: mock(() => {}),
    warn: mockWarn,
    error: mock(() => {}),
  }),
}));

const { runGhCommandWithBody } = await import('./gh-client');

describe('runGhCommandWithBody', () => {
  beforeEach(() => {
    capturedArgs = [];
    shouldGhFail = false;
    ghStdout = '';
    mockExecFile.mockClear();
    mockWriteFile.mockClear();
    mockWriteFile.mockImplementation(() => Promise.resolve());
    mockUnlink.mockClear();
    mockUnlink.mockImplementation(() => Promise.resolve());
    mockWarn.mockClear();
  });

  it('bodyあり: UTF-8 で writeFile し --body-file を args に付与する', async () => {
    ghStdout = 'https://github.com/owner/repo/issues/1';

    const result = await runGhCommandWithBody(
      ['issue', 'create', '--repo', 'owner/repo', '--title', 'Test'],
      'ボディ内容\n改行あり',
    );

    expect(result).toBe('https://github.com/owner/repo/issues/1');
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const [tmpPath, content, encoding] = mockWriteFile.mock.calls[0] as [string, string, string];
    expect(content).toBe('ボディ内容\n改行あり');
    expect(encoding).toBe('utf8');
    expect(tmpPath).toMatch(/gh-body-.+\.md$/);
    expect(capturedArgs).toContain('--body-file');
    expect(capturedArgs).toContain(tmpPath);
    expect(capturedArgs).not.toContain('--body');
    expect(mockUnlink).toHaveBeenCalledTimes(1);
    expect(mockUnlink.mock.calls[0][0]).toBe(tmpPath);
  });

  it('body = undefined: writeFile/unlink を呼ばず --body-file も付与しない', async () => {
    ghStdout = 'ok';

    await runGhCommandWithBody(['gh', '--version'], undefined);

    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockUnlink).not.toHaveBeenCalled();
    expect(capturedArgs).not.toContain('--body-file');
  });

  it('body = 空文字: 空ファイルを --body-file で渡す', async () => {
    ghStdout = '';

    await runGhCommandWithBody(['issue', 'comment', '1'], '');

    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const [, content] = mockWriteFile.mock.calls[0] as [string, string, string];
    expect(content).toBe('');
    expect(capturedArgs).toContain('--body-file');
    expect(mockUnlink).toHaveBeenCalledTimes(1);
  });

  it('gh コマンド失敗時も unlink を実行する (finally 保証)', async () => {
    shouldGhFail = true;

    await expect(runGhCommandWithBody(['issue', 'create'], 'ボディ')).rejects.toThrow();

    // unlink must be called even when the gh command fails
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockUnlink).toHaveBeenCalledTimes(1);
    const writtenPath = (mockWriteFile.mock.calls[0] as [string])[0];
    expect(mockUnlink.mock.calls[0][0]).toBe(writtenPath);
  });

  it('unlink 失敗は warn のみ — 成功結果は変えない', async () => {
    ghStdout = 'done';
    mockUnlink.mockRejectedValueOnce(new Error('EPERM: permission denied'));

    const result = await runGhCommandWithBody(['issue', 'view', '42'], 'body');

    expect(result).toBe('done');
    expect(mockWarn).toHaveBeenCalledTimes(1);
    const warnMsg = mockWarn.mock.calls[0][1] as string;
    expect(warnMsg).toContain('Failed to delete gh body temp file');
  });

  it('日本語・改行含む長文 (>32k 文字) を writeFile に正しく渡す', async () => {
    ghStdout = 'https://github.com/owner/repo/issues/42';
    const longBody = '# タスク\n\n現在、純粋\n\n## 詳細\n日本語テキスト'.repeat(500);

    await runGhCommandWithBody(['issue', 'create'], longBody);

    const [, content, encoding] = mockWriteFile.mock.calls[0] as [string, string, string];
    expect(content).toBe(longBody);
    expect(encoding).toBe('utf8');
  });

  it('並行呼び出しで一時ファイル名が衝突しない (uuid がユニーク)', async () => {
    ghStdout = 'ok';

    await Promise.all([
      runGhCommandWithBody(['cmd1'], 'body1'),
      runGhCommandWithBody(['cmd2'], 'body2'),
      runGhCommandWithBody(['cmd3'], 'body3'),
    ]);

    const paths = (mockWriteFile.mock.calls as [string, string, string][]).map(([p]) => p);
    const unique = new Set(paths);
    expect(unique.size).toBe(3);
  });
});
