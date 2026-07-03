/**
 * sanitize-cli-env ユニットテスト
 *
 * buildSanitizedSpawnEnv が headless エージェント CLI に渡す前に秘匿情報を確実に
 * 除去することを固定するリグレッションテスト。将来の変更がこの安全策を静かに
 * 緩めないようにする。実DB/実プロセスなしで動作する。
 */
import { describe, expect, test } from 'bun:test';
import { buildSanitizedSpawnEnv } from './sanitize-cli-env';

/** Runs `fn` with `vars` merged into process.env, restoring the previous values afterward. */
function withEnv(vars: Record<string, string>, fn: () => void): void {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    previous[key] = process.env[key];
    process.env[key] = vars[key];
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(vars)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

describe('buildSanitizedSpawnEnv', () => {
  test('exact-name denylist keys (ENCRYPTION_KEY / DATABASE_URL / DIRECT_DATABASE_URL) are stripped', () => {
    withEnv(
      {
        ENCRYPTION_KEY: 'secret',
        DATABASE_URL: 'postgres://u:p@host/db',
        DIRECT_DATABASE_URL: 'postgres://u:p@host/db2',
      },
      () => {
        const env = buildSanitizedSpawnEnv();
        expect(env.ENCRYPTION_KEY).toBeUndefined();
        expect(env.DATABASE_URL).toBeUndefined();
        expect(env.DIRECT_DATABASE_URL).toBeUndefined();
      },
    );
  });

  test('pattern-matched secret-shaped keys are stripped', () => {
    withEnv(
      {
        GITHUB_TOKEN: 'ghp_x',
        SOME_API_KEY: 'x',
        MY_PASSWORD: 'x',
        APP_SECRET: 'x',
        TLS_PRIVATE_KEY: 'x',
        SERVICE_CREDENTIAL: 'x',
      },
      () => {
        const env = buildSanitizedSpawnEnv();
        expect(env.GITHUB_TOKEN).toBeUndefined();
        expect(env.SOME_API_KEY).toBeUndefined();
        expect(env.MY_PASSWORD).toBeUndefined();
        expect(env.APP_SECRET).toBeUndefined();
        expect(env.TLS_PRIVATE_KEY).toBeUndefined();
        expect(env.SERVICE_CREDENTIAL).toBeUndefined();
      },
    );
  });

  test('ANTHROPIC_ prefixed keys survive even though they look secret-shaped', () => {
    withEnv({ ANTHROPIC_API_KEY: 'sk-ant-dummy' }, () => {
      const env = buildSanitizedSpawnEnv();
      expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-dummy');
    });
  });

  test('non-sensitive keys (e.g. PATH) are preserved untouched', () => {
    const env = buildSanitizedSpawnEnv();
    expect(env.PATH ?? env.Path).toBeDefined();
  });

  test('overrides are applied after sanitization, taking precedence', () => {
    withEnv({ ENCRYPTION_KEY: 'secret' }, () => {
      const env = buildSanitizedSpawnEnv({ FORCE_COLOR: '0', NO_COLOR: '1' });
      expect(env.ENCRYPTION_KEY).toBeUndefined();
      expect(env.FORCE_COLOR).toBe('0');
      expect(env.NO_COLOR).toBe('1');
    });
  });
});
