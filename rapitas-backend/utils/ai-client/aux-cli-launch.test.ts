/**
 * aux-cli-launch テスト
 *
 * 呼び出しごとのタイムアウトがランチャーまで届くことを固定する。
 *
 * 実測した欠陥（2026-10-12、ユーザー報告で発覚）:
 * `generate-claude-md` は `timeoutMs: 600000` を要求し、`resolveCliTimeoutMs` も
 * 600000 を返して JS 側のタイマーは 600 秒になる。しかしランチャー側の期限は
 * - Windows: windows-aux-job.ps1 の `$env:RAPITAS_AUX_AI_CLI_TIMEOUT_MS` or 120000
 * - Linux:   linux-aux-launcher.ts の `process.env.RAPITAS_AUX_AI_CLI_TIMEOUT_MS || 120000`
 * という**既定値のみ**で決まり、呼び出しごとの値を知らなかった。
 * 結果、2 分を超える補助CLI呼び出しは要求値に関係なく 120 秒で殺され
 * `Claude CLI exited 124: Auxiliary CLI launcher deadline exceeded` になる。
 * 4 文書を書く文書生成は毎回これに当たり、テンプレート雛形に落ちていた。
 *
 * ランチャーは既に同じ環境変数を読むので、env に載せるだけで両方が直る。
 */
import { describe, expect, test } from 'bun:test';
import { launcherEnv, LAUNCHER_TIMEOUT_ENV, prepareAuxCli } from './aux-cli-launch';
import { ClaudeCliUnavailableError } from './cli-errors';

test('unsupported ownership observation cannot silently select uncontained spawning', async () => {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { ...original, value: 'darwin' });
  try {
    await expect(prepareAuxCli('fixture', '/tmp', {})).rejects.toThrow('unavailable on darwin');
  } finally {
    Object.defineProperty(process, 'platform', original);
  }
});

test('unsupported platform rejection classifies as ClaudeCliUnavailableError (task #914)', async () => {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { ...original, value: 'darwin' });
  try {
    await expect(prepareAuxCli('fixture', '/tmp', {})).rejects.toBeInstanceOf(
      ClaudeCliUnavailableError,
    );
  } finally {
    Object.defineProperty(process, 'platform', original);
  }
});

describe('launcherEnv', () => {
  test('呼び出しごとのタイムアウトを環境変数に載せる', () => {
    const got = launcherEnv({ PATH: '/usr/bin' }, 600_000);
    expect(got[LAUNCHER_TIMEOUT_ENV]).toBe('600000');
    expect(got.PATH).toBe('/usr/bin');
  });

  test('プロセス既定の値を上書きする（呼び出し側の要求が勝つ）', () => {
    const got = launcherEnv({ [LAUNCHER_TIMEOUT_ENV]: '120000' }, 600_000);
    expect(got[LAUNCHER_TIMEOUT_ENV]).toBe('600000');
  });

  test('指定が無ければ env をそのまま返す（既定の挙動を変えない）', () => {
    const base = { [LAUNCHER_TIMEOUT_ENV]: '120000', PATH: '/usr/bin' };
    expect(launcherEnv(base)).toEqual(base);
  });

  for (const [name, value] of [
    ['0', 0],
    ['負値', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ] as const) {
    test(`${name} は無視する（ランチャーは 0 と UInt32.MaxValue を不正として拒否する）`, () => {
      const base = { [LAUNCHER_TIMEOUT_ENV]: '120000' };
      expect(launcherEnv(base, value)[LAUNCHER_TIMEOUT_ENV]).toBe('120000');
    });
  }

  test('小数は整数に丸める（uint32 として解釈されるため）', () => {
    expect(launcherEnv({}, 1234.7)[LAUNCHER_TIMEOUT_ENV]).toBe('1235');
  });

  test('元の env を書き換えない', () => {
    const base: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
    launcherEnv(base, 600_000);
    expect(base[LAUNCHER_TIMEOUT_ENV]).toBeUndefined();
  });
});
