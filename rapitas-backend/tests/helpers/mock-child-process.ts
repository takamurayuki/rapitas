/**
 * mock-child-process.ts
 *
 * `child_process` / `node:child_process` モジュール全体を差し替えるファクトリ関数を提供する。
 * 13 ファイルで重複宣言されている child_process モック定型を一元化する。
 *
 * NOTE: `util.promisify` のモックはスコープ外。`util` 全体のモックは多数の export を
 * 巻き込み破壊的なため、promisify を必要とする2ファイルは各テストに据え置きとする。
 *
 * 使い方（exec/execFile が必要な場合）:
 *   import { childProcessModuleFactory } from '../helpers/mock-child-process';
 *   const mockExecAsync = mock(() => Promise.resolve({ stdout: 'ok', stderr: '' }));
 *   const factory = childProcessModuleFactory({ execAsync: mockExecAsync });
 *   mock.module('child_process', factory);
 *   mock.module('node:child_process', factory); // 両エイリアスが必要な場合
 *   const { myModule } = await import('../../myModule');
 *
 * このファイル自身は mock.module を呼ばない ─ bun の hoisting 制約に従い、
 * 呼び出しはテストファイル側の責務。
 */
import { mock } from 'bun:test';

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

/** exec / execFile のコールバック形式で受け取る stdout/stderr */
export interface ExecResult {
  stdout: string;
  stderr: string;
}

/** childProcessModuleFactory に渡せるオプション */
export interface ChildProcessMockOptions {
  /**
   * exec / execFile の非同期実装。
   * 省略した場合は `() => Promise.resolve({ stdout: '', stderr: '' })` が使われる。
   *
   * テストファイル側でスパイを注入することで呼び出し回数・引数を検証できる:
   *   const mockExecAsync = mock(() => Promise.resolve({ stdout: 'sha', stderr: '' }));
   *   const factory = childProcessModuleFactory({ execAsync: mockExecAsync });
   */
  execAsync?: () => Promise<ExecResult>;

  /**
   * execSync の実装。
   * 省略した場合は `() => Buffer.from('')` が使われる。
   */
  execSync?: (...args: unknown[]) => Buffer | string;
}

/** childProcessModuleFactory が返すモジュール構造 */
export interface ChildProcessModule {
  exec: ReturnType<typeof mock>;
  execFile: ReturnType<typeof mock>;
  execSync: ReturnType<typeof mock>;
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/**
 * `child_process` モジュール全体を差し替えるファクトリ。
 *
 * - `exec` / `execFile` は `(cmd, opts, callback)` 形式で、
 *   `opts.execAsync` の結果を callback に渡す（github-service.test.ts の慣行に準拠）
 * - `execSync` は `opts.execSync ?? (() => Buffer.from(''))` を使う
 * - factory は純関数なので `mock.module('child_process', factory)` と
 *   `mock.module('node:child_process', factory)` の両方に渡して使える
 *
 * @param opts - 動作をカスタマイズするオプション / options
 * @returns child_process モジュールと同一構造のオブジェクト / module-like object
 */
export function childProcessModuleFactory(
  opts?: ChildProcessMockOptions,
): () => ChildProcessModule {
  return () => {
    const execAsync = opts?.execAsync ?? (() => Promise.resolve({ stdout: '', stderr: '' }));
    const execSyncImpl = opts?.execSync ?? (() => Buffer.from(''));

    const execMock = mock(
      (_cmd: unknown, _optsOrCb: unknown, cb?: (err: Error | null, result: ExecResult) => void) => {
        // exec(cmd, callback) と exec(cmd, options, callback) の両形式に対応
        const callback =
          typeof _optsOrCb === 'function'
            ? (_optsOrCb as (err: Error | null, result: ExecResult) => void)
            : cb;
        if (callback) {
          execAsync()
            .then((r) => callback(null, r))
            .catch((e: Error) => callback(e, { stdout: '', stderr: '' }));
        }
      },
    );

    const execFileMock = mock(
      (
        _file: unknown,
        _argsOrOptsOrCb: unknown,
        _optsOrCb?: unknown,
        cb?: (err: Error | null, result: ExecResult) => void,
      ) => {
        // execFile のオーバーロードを簡略化して最後の関数引数を callback とみなす
        const args = [_argsOrOptsOrCb, _optsOrCb, cb];
        const callback = args
          .slice()
          .reverse()
          .find((a) => typeof a === 'function') as
          ((err: Error | null, result: ExecResult) => void) | undefined;
        if (callback) {
          execAsync()
            .then((r) => callback(null, r))
            .catch((e: Error) => callback(e, { stdout: '', stderr: '' }));
        }
      },
    );

    const execSyncMock = mock(execSyncImpl);

    return {
      exec: execMock,
      execFile: execFileMock,
      execSync: execSyncMock,
    };
  };
}
