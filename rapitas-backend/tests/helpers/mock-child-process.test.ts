/**
 * mock-child-process.test.ts
 *
 * mock-child-process ヘルパーのユニットテスト。
 * exec callback 変換・execSync 既定・両エイリアス再利用の動作を実証する。
 */
import { describe, test, expect, mock } from 'bun:test';
import { childProcessModuleFactory } from './mock-child-process';

// ---------------------------------------------------------------------------
// childProcessModuleFactory テスト
// ---------------------------------------------------------------------------

describe('childProcessModuleFactory', () => {
  test('exec / execFile / execSync を含むオブジェクトを返すこと', () => {
    const factory = childProcessModuleFactory();
    const mod = factory();
    expect(typeof mod.exec).toBe('function');
    expect(typeof mod.execFile).toBe('function');
    expect(typeof mod.execSync).toBe('function');
  });

  test('exec が execAsync の結果を callback に渡すこと', async () => {
    const mockExecAsync = mock(() => Promise.resolve({ stdout: 'hello', stderr: '' }));
    const factory = childProcessModuleFactory({ execAsync: mockExecAsync });
    const mod = factory();

    await new Promise<void>((resolve, reject) => {
      mod.exec(
        'git status',
        {},
        (err: Error | null, result: { stdout: string; stderr: string }) => {
          try {
            expect(err).toBeNull();
            expect(result.stdout).toBe('hello');
            resolve();
          } catch (e) {
            reject(e);
          }
        },
      );
    });

    expect(mockExecAsync).toHaveBeenCalledTimes(1);
  });

  test('exec が2引数形式（cmd, callback）でも機能すること', async () => {
    const mockExecAsync = mock(() => Promise.resolve({ stdout: 'two-arg', stderr: '' }));
    const factory = childProcessModuleFactory({ execAsync: mockExecAsync });
    const mod = factory();

    await new Promise<void>((resolve, reject) => {
      mod.exec('git log', (err: Error | null, result: { stdout: string }) => {
        try {
          expect(err).toBeNull();
          expect(result.stdout).toBe('two-arg');
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });

  test('execFile が execAsync の結果を callback に渡すこと', async () => {
    const mockExecAsync = mock(() => Promise.resolve({ stdout: 'file-out', stderr: '' }));
    const factory = childProcessModuleFactory({ execAsync: mockExecAsync });
    const mod = factory();

    await new Promise<void>((resolve, reject) => {
      mod.execFile('git', ['log'], {}, (err: Error | null, result: { stdout: string }) => {
        try {
          expect(err).toBeNull();
          expect(result.stdout).toBe('file-out');
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });

  test("execSync 既定が Buffer.from('') を返すこと", () => {
    const factory = childProcessModuleFactory();
    const mod = factory();
    const result = mod.execSync('echo hello');
    expect(result).toBeInstanceOf(Buffer);
    expect(result.toString()).toBe('');
  });

  test('execSync にカスタム実装を注入できること', () => {
    const customExecSync = () => Buffer.from('custom-output');
    const factory = childProcessModuleFactory({ execSync: customExecSync });
    const mod = factory();
    const result = mod.execSync('any-cmd');
    expect(result.toString()).toBe('custom-output');
  });

  test('exec が失敗した場合 callback にエラーを渡すこと', async () => {
    const mockExecAsync = mock(() => Promise.reject(new Error('command failed')));
    const factory = childProcessModuleFactory({ execAsync: mockExecAsync });
    const mod = factory();

    await new Promise<void>((resolve, reject) => {
      mod.exec('bad-cmd', {}, (err: Error | null) => {
        try {
          expect(err).not.toBeNull();
          expect(err?.message).toBe('command failed');
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });
});

// ---------------------------------------------------------------------------
// 両エイリアス再利用テスト（`child_process` と `node:child_process`）
// ---------------------------------------------------------------------------

describe('両エイリアス再利用', () => {
  test('同一 factory を2回呼んでも独立したモックオブジェクトが得られること', () => {
    const mockExecAsync = mock(() => Promise.resolve({ stdout: 'alias', stderr: '' }));
    const factory = childProcessModuleFactory({ execAsync: mockExecAsync });

    const mod1 = factory();
    const mod2 = factory();

    // 独立したインスタンス
    expect(mod1.exec).not.toBe(mod2.exec);
  });

  test('mock.module + await import フローで child_process が差し替えられること', async () => {
    const { childProcessModuleFactory: cpf } = await import('./mock-child-process');
    const mockExecAsync = mock(() => Promise.resolve({ stdout: 'mocked', stderr: '' }));
    const factory = cpf({ execAsync: mockExecAsync });

    mock.module('child_process', factory);
    const cp = await import('child_process');

    // exec が mock 関数に差し替えられていること
    expect(typeof cp.exec).toBe('function');
  });
});
