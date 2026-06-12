/**
 * local-auth テスト
 *
 * バインドホスト解決（loopbackデフォルト・トークン無し非loopback拒否）と、
 * APIトークンガード（Bearer/queryトークン受理・不一致401・OPTIONS素通し）の検証。
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { resolveBindHost, createApiTokenGuard } from '../../middleware/local-auth';

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  delete process.env.RAPITAS_BIND_HOST;
  delete process.env.RAPITAS_API_TOKEN;
}

describe('resolveBindHost', () => {
  beforeEach(resetEnv);
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  test('デフォルトは 127.0.0.1（loopback）であること', () => {
    expect(resolveBindHost()).toBe('127.0.0.1');
  });

  test('loopback 系の指定はそのまま 127.0.0.1 に正規化されること', () => {
    process.env.RAPITAS_BIND_HOST = 'localhost';
    expect(resolveBindHost()).toBe('127.0.0.1');
  });

  test('非loopback 指定でもトークン未設定なら 127.0.0.1 へフォールバックすること', () => {
    process.env.RAPITAS_BIND_HOST = '0.0.0.0';
    expect(resolveBindHost()).toBe('127.0.0.1');
  });

  test('非loopback 指定＋トークン設定で初めて要求ホストを返すこと', () => {
    process.env.RAPITAS_BIND_HOST = '0.0.0.0';
    process.env.RAPITAS_API_TOKEN = 'secret-token';
    expect(resolveBindHost()).toBe('0.0.0.0');
  });
});

describe('createApiTokenGuard', () => {
  beforeEach(resetEnv);
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  test('トークン未設定なら null（ガード無効）を返すこと', () => {
    expect(createApiTokenGuard()).toBeNull();
  });

  test('正しい Bearer トークンは通過すること', () => {
    process.env.RAPITAS_API_TOKEN = 'secret-token';
    const guard = createApiTokenGuard()!;
    const res = guard({
      request: new Request('http://localhost:3001/tasks', {
        headers: { authorization: 'Bearer secret-token' },
      }),
    });
    expect(res).toBeUndefined();
  });

  test('?token= クエリ（EventSource 用）も通過すること', () => {
    process.env.RAPITAS_API_TOKEN = 'secret-token';
    const guard = createApiTokenGuard()!;
    const res = guard({
      request: new Request('http://localhost:3001/events/subscribe/%2A?token=secret-token'),
    });
    expect(res).toBeUndefined();
  });

  test('トークン無し/不一致は 401 を返すこと', async () => {
    process.env.RAPITAS_API_TOKEN = 'secret-token';
    const guard = createApiTokenGuard()!;

    const missing = guard({ request: new Request('http://localhost:3001/tasks') });
    expect(missing?.status).toBe(401);

    const wrong = guard({
      request: new Request('http://localhost:3001/tasks', {
        headers: { authorization: 'Bearer wrong' },
      }),
    });
    expect(wrong?.status).toBe(401);
  });

  test('OPTIONS（CORS preflight）はトークン無しでも通過すること', () => {
    process.env.RAPITAS_API_TOKEN = 'secret-token';
    const guard = createApiTokenGuard()!;
    const res = guard({
      request: new Request('http://localhost:3001/tasks', { method: 'OPTIONS' }),
    });
    expect(res).toBeUndefined();
  });
});
