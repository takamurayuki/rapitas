/**
 * Temp Statistics Routes テスト
 * プレースホルダールート（ルート未定義スタブ）のユニットテスト
 */
import { describe, test, expect } from 'bun:test';
import { Elysia } from 'elysia';
import { tempStatisticsRoutes } from '../../../routes/tasks/temp-statistics';

function createApp() {
  return new Elysia().use(tempStatisticsRoutes);
}

describe('temp-statistics stub route', () => {
  test('プレフィックス配下にルートが定義されていないため404を返すこと', async () => {
    const app = createApp();

    const res = await app.handle(new Request('http://localhost/temp-statistics'));

    expect(res.status).toBe(404);
  });

  test('プレフィックス配下の任意のパスも404を返すこと', async () => {
    const app = createApp();

    const res = await app.handle(new Request('http://localhost/temp-statistics/summary'));

    expect(res.status).toBe(404);
  });

  test('他のプレフィックスと衝突しないこと', async () => {
    const app = createApp();

    const res = await app.handle(new Request('http://localhost/other'));

    expect(res.status).toBe(404);
  });
});
