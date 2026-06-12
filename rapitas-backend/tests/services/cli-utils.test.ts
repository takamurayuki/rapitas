/**
 * cli-utils unit tests
 *
 * Tests for resolveCliPath(): covers where-success, .cmd-fallback, and both-fail paths.
 * getClaudePath() platform branching is also verified.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

// ---------------------------------------------------------------------------
// Mutable state read by all mock implementations — lets each test set its own
// behaviour without re-requiring the module (cliPathCache is module-scoped).
// ---------------------------------------------------------------------------

let execSyncImpl: (cmd: string) => string = () => {
  throw new Error('not configured');
};
let existsSyncImpl: (p: string) => boolean = () => true;

const mockWarn = mock((..._args: unknown[]) => {});
const mockInfo = mock((..._args: unknown[]) => {});

mock.module('child_process', () => ({
  execSync: (cmd: string, _opts: unknown) => execSyncImpl(cmd),
  spawn: mock(() => ({ on: mock(() => {}), kill: mock(() => {}) })),
}));

mock.module('fs', () => ({
  existsSync: (p: string) => existsSyncImpl(p),
}));

mock.module('../../config/logger', () => ({
  createLogger: () => ({
    warn: mockWarn,
    info: mockInfo,
    error: mock(() => {}),
    debug: mock(() => {}),
  }),
}));

// Import after mocks so the module sees the mocked implementations.
const { resolveCliPath, getClaudePath } = await import(
  '../../services/agents/claude-code/cli-utils'
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Unique CLI names prevent cliPathCache from returning stale results. */
let nameSeq = 0;
const uniqueName = (prefix: string) => `${prefix}-${++nameSeq}`;

beforeEach(() => {
  mockWarn.mockClear();
  mockInfo.mockClear();
});

// ---------------------------------------------------------------------------
// resolveCliPath
// ---------------------------------------------------------------------------

describe('resolveCliPath', () => {
  it('非Windowsでは where を呼ばずに元の名前をそのまま返す', () => {
    if (process.platform === 'win32') return; // Windows 専用テストは skip

    const name = uniqueName('test-cli');
    const result = resolveCliPath(name);

    expect(result).toBe(name);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('where が成功したとき絶対パスを返し INFO ログを出す', () => {
    if (process.platform !== 'win32') return;

    const absPath = 'C:\\npm\\claude.cmd';
    execSyncImpl = (_cmd) => `${absPath}\r\n`;
    existsSyncImpl = () => true;

    const name = uniqueName('test-where-ok');
    const result = resolveCliPath(name);

    expect(result).toBe(absPath);
    expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('[resolveCliPath]'));
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('where が失敗しても .cmd 再試行が成功すれば WARN を出さずに絶対パスを返す', () => {
    if (process.platform !== 'win32') return;

    const cmdPath = 'C:\\npm\\claude.cmd';
    execSyncImpl = (cmd) => {
      // bare name fails; .cmd variant succeeds
      if (cmd.endsWith('.cmd')) return `${cmdPath}\r\n`;
      throw new Error('not found');
    };
    existsSyncImpl = () => true;

    const name = uniqueName('test-cmd-fallback');
    const result = resolveCliPath(name);

    expect(result).toBe(cmdPath);
    expect(mockWarn).not.toHaveBeenCalled();
    expect(mockInfo).toHaveBeenCalled();
  });

  it('.cmd で終わる名前は .cmd 再試行をしない（無限ループ防止）', () => {
    if (process.platform !== 'win32') return;

    let callCount = 0;
    execSyncImpl = (_cmd) => {
      callCount++;
      throw new Error('not found');
    };
    existsSyncImpl = () => false;

    const name = `${uniqueName('test-already-cmd')}.cmd`;
    resolveCliPath(name);

    expect(callCount).toBe(1); // where は1回だけ呼ばれる
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('[resolveCliPath]'),
    );
  });

  it('where と .cmd 再試行の両方が失敗したとき WARN を出して元の名前を返す', () => {
    if (process.platform !== 'win32') return;

    execSyncImpl = (_cmd) => {
      throw new Error('not found');
    };
    existsSyncImpl = () => false;

    const name = uniqueName('test-both-fail');
    const result = resolveCliPath(name);

    expect(result).toBe(name);
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('[resolveCliPath]'),
    );
  });

  it('同じ名前への2回目の呼び出しはキャッシュから返す（where は再呼び出しされない）', () => {
    if (process.platform !== 'win32') return;

    const absPath = 'C:\\npm\\claude-cached.cmd';
    let callCount = 0;
    execSyncImpl = (_cmd) => {
      callCount++;
      return `${absPath}\r\n`;
    };
    existsSyncImpl = () => true;

    const name = uniqueName('test-cache');
    resolveCliPath(name);
    resolveCliPath(name);

    // execSync は1回だけ（2回目はキャッシュ）
    expect(callCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getClaudePath
// ---------------------------------------------------------------------------

describe('getClaudePath', () => {
  it('CLAUDE_CODE_PATH が未設定のとき Windows では claude.cmd を基底名に使う', () => {
    if (process.platform !== 'win32') return;

    const original = process.env.CLAUDE_CODE_PATH;
    delete process.env.CLAUDE_CODE_PATH;

    const absPath = 'C:\\npm\\claude.cmd';
    execSyncImpl = (_cmd) => `${absPath}\r\n`;
    existsSyncImpl = () => true;

    const result = getClaudePath();
    expect(result).toBe(absPath);

    if (original !== undefined) process.env.CLAUDE_CODE_PATH = original;
  });
});
